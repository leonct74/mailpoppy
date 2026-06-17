// Attachment helpers for the mobile client:
//  - saveOrShareAttachment: download a received attachment and hand it to the
//    native iOS/Android share sheet (which, for images, offers "Save Image" →
//    Photos, and Files/Drive for other types) — same affordance Gmail uses.
//  - pickFileAttachment / pickPhotoAttachment: let the user attach a file or a
//    photo to an outgoing message, kept as a local file URI.
//  - uploadAttachmentToS3: PUT that local file straight to S3 via a presigned
//    URL, so large attachments never travel through API Gateway / the Lambda.
import { Linking } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
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

/**
 * Download a received attachment to the cache and open the native share sheet.
 * For an image this includes "Save Image" (Photos); for PDFs/docs it offers
 * Files, Drive, etc. Falls back to opening the URL if sharing is unavailable.
 */
export async function saveOrShareAttachment(
  url: string,
  filename: string,
  contentType?: string,
): Promise<void> {
  const target = `${FileSystem.cacheDirectory}${Date.now()}_${sanitize(filename)}`;
  const { uri } = await FileSystem.downloadAsync(url, target);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: contentType, dialogTitle: filename });
  } else {
    await Linking.openURL(url);
  }
}

/**
 * Save/share an ENCRYPTED attachment. The S3 object is base64 ciphertext (text),
 * so we fetch it, decrypt with the cached mailbox key (decryption happens on the
 * device — the bytes are never readable server-side), write the plaintext to the
 * cache, and hand it to the share sheet. No CORS concerns: this is a native fetch.
 */
export async function saveOrShareEncryptedAttachment(
  url: string,
  meta: EncryptedRef,
  filename: string,
  contentType?: string,
): Promise<void> {
  const ciphertextB64 = await (await fetch(url)).text();
  const bytes = await decryptAttachmentBytes(meta, ciphertextB64);
  const target = `${FileSystem.cacheDirectory}${Date.now()}_${sanitize(filename)}`;
  await FileSystem.writeAsStringAsync(target, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target, { mimeType: contentType, dialogTitle: filename });
  } else {
    throw new Error("Sharing isn't available on this device, so this encrypted file can't be opened here.");
  }
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
