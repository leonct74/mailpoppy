// Attachment helpers for the mobile client:
//  - saveOrShareAttachment: download a received attachment and hand it to the
//    native iOS/Android share sheet (which, for images, offers "Save Image" →
//    Photos, and Files/Drive for other types) — same affordance Gmail uses.
//  - pickFileAttachment / pickPhotoAttachment: let the user attach a file or a
//    photo to an outgoing message, kept as a local file URI.
//  - uploadAttachmentToS3: PUT that local file straight to S3 via a presigned
//    URL, so large attachments never travel through API Gateway / the Lambda.
import { Linking } from "react-native";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { decryptAttachmentBytes, type EncryptedRef } from "./mailboxKeys";
import { bytesToBase64 } from "./sodium";

export interface PickedAttachment {
  filename: string;
  contentType: string;
  /** Local file:// URI — uploaded directly to S3 via a presigned PUT at send. */
  uri: string;
  sizeBytes: number;
}

/** Keep a safe, extension-preserving filename for the local cache copy. */
function sanitize(name: string): string {
  const cleaned = (name || "attachment").replace(/[^\w.\-]+/g, "_");
  return cleaned.slice(-120) || "attachment";
}

/** Cache GENERATION — the app's NATIVE BUILD NUMBER, so every new app build starts
 *  from a clean attachment cache automatically. The deterministic key below survives
 *  app updates, and a corrupt file written by an old build's pipeline would otherwise
 *  be served forever (PDFs self-heal via a magic-byte check, but a black-rendering
 *  image had no cure). Costs one re-download per attachment after an update; buys
 *  never debugging a stale-cache ghost again. */
const CACHE_GEN = `b${sanitize(Constants.nativeBuildVersion ?? "dev")}`;

/** All cached attachments live under one generation-scoped directory, so stale
 *  generations are a single directory delete (see {@link sweepStaleAttachmentCache}). */
const CACHE_ROOT = `${FileSystem.cacheDirectory}attachments/`;
const CACHE_DIR = `${CACHE_ROOT}${CACHE_GEN}/`;

async function ensureCacheDir(): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  } catch {
    /* already exists */
  }
}

/** Delete attachment caches written by OTHER app builds. Called once at app start;
 *  best-effort (a failed sweep just leaves files for the OS cache janitor). */
export async function sweepStaleAttachmentCache(): Promise<void> {
  try {
    const entries = await FileSystem.readDirectoryAsync(CACHE_ROOT);
    for (const name of entries) {
      if (name !== CACHE_GEN) {
        await FileSystem.deleteAsync(`${CACHE_ROOT}${name}`, { idempotent: true }).catch(() => {});
      }
    }
  } catch {
    /* no cache dir yet — nothing to sweep */
  }
}

/** The local cache path for an attachment. With a `cacheKey` (message id + index)
 *  the name is DETERMINISTIC, so the same attachment is fetched/decrypted once and
 *  every later view reuses the file; without one, a unique temp name is used. */
function cachePath(filename: string, cacheKey?: string): string {
  return `${CACHE_DIR}${sanitize(cacheKey ?? String(Date.now()))}_${sanitize(filename)}`;
}

async function existing(path: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && (info.size ?? 0) > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Cheap on-disk sanity check: does this cached file actually start with the PDF
 * magic bytes `%PDF-`? Read as base64 so we can peek just the header. Used before
 * handing a file to the native PDFKit view — a decrypt that produced garbage
 * (e.g. a re-keyed mailbox / wrong wrapped key) or a 0-length/partial write would
 * otherwise mount, flash black and error out. Returning false routes the caller
 * to the share / Quick Look sheet instead of the in-app viewer.
 */
export async function looksLikePdf(fileUri: string): Promise<boolean> {
  try {
    // base64 of the 5 bytes "%PDF-" is "JVBERi0" (7 chars). Reading 6 bytes gives
    // 8 base64 chars; the first 7 are what we compare, so 6 bytes is plenty.
    const head = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 6,
    });
    return head.startsWith("JVBERi0");
  } catch {
    return false;
  }
}

/** Read the first `byteLen` bytes of a file (via the ranged base64 API). */
async function readHeadBytes(fileUri: string, byteLen: number): Promise<Uint8Array | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: byteLen + 2, // a little slack so the base64 decode covers byteLen bytes
    });
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const rev: Record<string, number> = {};
    for (let i = 0; i < ALPHA.length; i++) rev[ALPHA[i]!] = i;
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const ch of b64) {
      const v = rev[ch];
      if (v === undefined) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 0xff);
        if (out.length >= byteLen) break;
      }
    }
    return Uint8Array.from(out);
  } catch {
    return null;
  }
}

/**
 * Does this cached file start like a real image? Same job as {@link looksLikePdf} but
 * for images — the PDF path self-heals a corrupt cached file via its magic-byte check,
 * while a corrupt "image" used to render as a silent black screen forever. Covers the
 * formats mail actually carries: JPEG, PNG, GIF, WebP, HEIC/HEIF/AVIF, BMP, TIFF.
 */
export async function looksLikeImage(fileUri: string): Promise<boolean> {
  const h = await readHeadBytes(fileUri, 12);
  if (!h || h.length < 4) return false;
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return true; // JPEG
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return true; // PNG
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return true; // GIF8
  if (h[0] === 0x42 && h[1] === 0x4d) return true; // BMP
  if ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2a) || (h[0] === 0x4d && h[1] === 0x4d && h[2] === 0x00)) return true; // TIFF
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return true; // RIFF (WebP)
  // ISO-BMFF (HEIC/HEIF/AVIF): "ftyp" at byte 4.
  if (h.length >= 8 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return true;
  return false;
}

/** Delete a cached attachment file (best effort). Used to bust a stale/corrupt copy
 *  — the cache is keyed by message+index and survives app updates, so a bad file
 *  written by an earlier build would otherwise be served forever. */
export async function bustCachedFile(fileUri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    /* best effort — a missing file is fine */
  }
}

/** Size + a printable-ASCII peek at a file's first bytes (via the ranged base64 API). */
async function headInfo(fileUri: string): Promise<{ size: number; ascii: string } | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    const size = info.exists ? (info.size ?? 0) : 0;
    const b64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 18,
    });
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const rev: Record<string, number> = {};
    for (let i = 0; i < ALPHA.length; i++) rev[ALPHA[i]!] = i;
    let acc = 0;
    let bits = 0;
    let ascii = "";
    for (const ch of b64) {
      const v = rev[ch];
      if (v === undefined) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        const c = (acc >> bits) & 0xff;
        ascii += c >= 32 && c < 127 ? String.fromCharCode(c) : "·";
      }
    }
    return { size, ascii: ascii.slice(0, 12) };
  } catch {
    return null;
  }
}

/** A short diagnostic description of a file's first bytes: its size plus a
 *  printable-ASCII peek at the header. Explains WHY a "PDF" won't open — e.g. an S3
 *  error page begins "<?xml", a JSON error begins "{", double-base64 begins "JVBER",
 *  a real (if truncated) PDF begins "%PDF-". */
export async function describeFileHead(fileUri: string): Promise<string> {
  const h = await headInfo(fileUri);
  return h ? `${h.size} bytes, begins "${h.ascii}"` : "file unreadable";
}

/**
 * Explain an unreadable attachment file to a PERSON, not a developer: a plain-language
 * `message` saying what happened and what to do, plus a one-line technical `detail`
 * (kept small in the UI) that support/debugging can act on. The classification uses the
 * same file-head signals as {@link describeFileHead}.
 */
export async function explainUnreadableFile(
  fileUri: string,
  expected: "PDF" | "image",
): Promise<{ message: string; detail: string }> {
  const h = await headInfo(fileUri);
  const detail = `Technical detail: ${h ? `${h.size} bytes, begins "${h.ascii}"` : "file unreadable"}`;
  if (!h || h.size === 0) {
    return {
      message: "The download didn't complete — the file arrived empty. This is usually a hiccup in the connection. Tap “Try again”.",
      detail,
    };
  }
  if (h.ascii.startsWith("<?xml") || h.ascii.startsWith("{")) {
    return {
      message: "The mail server sent an error page instead of the file — the download link probably expired. This fixes itself with a fresh download. Tap “Try again”.",
      detail,
    };
  }
  if (expected === "PDF" && h.ascii.startsWith("JVBER")) {
    return {
      message: "The file was saved in the wrong format on this phone. Tap “Try again” to download a clean copy.",
      detail,
    };
  }
  return {
    message: `This doesn't look like a ${expected === "PDF" ? "PDF" : "picture"} this phone can display — the file may have been damaged. Tap “Try again” for a fresh download, or open it in another app.`,
    detail,
  };
}

/** Download a received attachment into the cache, returning its local file:// URI
 *  (used both to preview attachments in-app and as the staging step before sharing).
 *  A deterministic `cacheKey` makes repeat views hit the cached copy. */
export async function fetchAttachmentToCache(url: string, filename: string, cacheKey?: string): Promise<string> {
  const target = cachePath(filename, cacheKey);
  if (cacheKey) {
    const hit = await existing(target);
    if (hit) return hit;
  }
  await ensureCacheDir();
  const res = await FileSystem.downloadAsync(url, target);
  if (res.status < 200 || res.status >= 300) {
    // downloadAsync writes ANY response body to the file — including an expired
    // presigned URL's 403 XML error page, which would then be cached as "the PDF".
    // Delete it and surface the failure instead of caching an error page.
    await bustCachedFile(res.uri);
    throw new Error(
      `The attachment couldn't be downloaded. Please check your connection and try again. (The server answered with error ${res.status}.)`,
    );
  }
  return res.uri;
}

/**
 * Fetch an ENCRYPTED attachment into the cache, returning its local file:// URI.
 * The S3 object is base64 ciphertext (text), so we fetch it, decrypt with the
 * cached mailbox key (decryption happens on the device — the bytes are never
 * readable server-side) and write the plaintext to the cache. No CORS concerns:
 * this is a native fetch. A deterministic `cacheKey` makes repeat views reuse the
 * already-decrypted copy (the OS-purgeable cache dir, same place as before).
 */
export async function fetchEncryptedAttachmentToCache(
  url: string,
  meta: EncryptedRef,
  filename: string,
  cacheKey?: string,
): Promise<string> {
  const target = cachePath(filename, cacheKey);
  if (cacheKey) {
    const hit = await existing(target);
    if (hit) return hit;
  }
  const res = await fetch(url);
  if (!res.ok) {
    // An expired presigned URL returns a 403 XML error body — decrypting that as
    // ciphertext would fail confusingly. Surface the download failure directly.
    throw new Error(
      `The attachment couldn't be downloaded. Please check your connection and try again. (The server answered with error ${res.status}.)`,
    );
  }
  const ciphertextB64 = await res.text();
  const bytes = await decryptAttachmentBytes(meta, ciphertextB64);
  // Decryption of a re-keyed / orphaned mailbox can silently yield empty or
  // garbage bytes. Surface that as a real error here rather than writing a
  // non-openable file that flashes black in the PDF viewer downstream.
  // (Deliberately does NOT tell the user to re-enter their password — feeding an
  // unverified password into key setup can re-key the mailbox and orphan old mail.)
  if (!bytes || bytes.length === 0) {
    throw new Error(
      "This attachment couldn't be unlocked on this phone. Close the email and open it again — if it keeps happening, the mailbox may have been reset by an administrator.",
    );
  }
  await ensureCacheDir();
  await FileSystem.writeAsStringAsync(target, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
  return target;
}

/**
 * ANDROID: open a cached file directly in the user's default viewer app (e.g. the
 * system PDF viewer) via an ACTION_VIEW intent — the "just show it" behaviour Android
 * users expect, without a share-sheet detour. Falls back to the share sheet when no
 * app can display the type.
 */
export async function openInAndroidViewer(uri: string, filename: string, contentType?: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(uri);
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: contentType,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch {
    await shareLocalFile(uri, filename, contentType); // no viewer installed → let the user pick
  }
}

/** Hand an already-cached file to the native share sheet (for an image this
 *  includes "Save Image" → Photos; for PDFs/docs it offers Files, Drive, etc.). */
export async function shareLocalFile(uri: string, filename: string, contentType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device, so this file can't be opened here.");
  }
  await Sharing.shareAsync(uri, { mimeType: contentType, dialogTitle: filename });
}

/** Download a received attachment to the cache and open the native share sheet.
 *  Falls back to opening the URL if sharing is unavailable. */
export async function saveOrShareAttachment(
  url: string,
  filename: string,
  contentType?: string,
): Promise<void> {
  const uri = await fetchAttachmentToCache(url, filename);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: contentType, dialogTitle: filename });
  } else {
    await Linking.openURL(url);
  }
}

/** Save/share an ENCRYPTED attachment (fetch → on-device decrypt → share sheet). */
export async function saveOrShareEncryptedAttachment(
  url: string,
  meta: EncryptedRef,
  filename: string,
  contentType?: string,
): Promise<void> {
  const uri = await fetchEncryptedAttachmentToCache(url, meta, filename);
  await shareLocalFile(uri, filename, contentType);
}

async function asAttachment(
  uri: string,
  filename: string,
  contentType: string,
  sizeHint: number,
): Promise<PickedAttachment> {
  let sizeBytes = sizeHint > 0 ? sizeHint : 0;
  if (sizeBytes === 0) {
    // The picker didn't report a size — read it off disk so the limit check and
    // presign request are accurate.
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof info.size === "number") sizeBytes = info.size;
    } catch {
      /* leave at 0; the server-side cap still applies */
    }
  }
  return {
    filename: filename || "attachment",
    contentType: contentType || "application/octet-stream",
    uri,
    sizeBytes,
  };
}

/** Pick any file (Files app, iCloud Drive, etc.) to attach. Null if cancelled. */
export async function pickFileAttachment(): Promise<PickedAttachment | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return asAttachment(a.uri, a.name, a.mimeType ?? "application/octet-stream", a.size ?? 0);
}

/** Pick a photo from the library to attach. Null if cancelled. */
export async function pickPhotoAttachment(): Promise<PickedAttachment | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const name = a.fileName || `photo-${Date.now()}.jpg`;
  return asAttachment(a.uri, name, a.mimeType ?? "image/jpeg", a.fileSize ?? 0);
}

/**
 * Upload a picked file straight to S3 using a presigned PUT URL (from
 * mail.presignAttachment). The bytes go directly to the bucket — never through
 * API Gateway / the Lambda — so attachments can be as large as the admin allows.
 * Throws on a non-2xx response.
 */
export async function uploadAttachmentToS3(
  presignedUrl: string,
  uri: string,
  contentType: string,
): Promise<void> {
  const res = await FileSystem.uploadAsync(presignedUrl, uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "content-type": contentType },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`upload failed (${res.status})`);
  }
}
