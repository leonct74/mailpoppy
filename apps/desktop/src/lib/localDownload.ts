// Save bytes that exist only in the webview (e.g. a *decrypted* attachment) to a
// file the user can keep. WKWebView won't honour a blob/`<a download>` click, so
// we hand the bytes to the local sidecar for a one-shot token and open the
// matching loopback URL through the system browser — which downloads it cleanly
// (the sidecar sets Content-Disposition: attachment). This mirrors how plaintext
// attachments are handed off (openExternal on the presigned S3 URL).
import { sidecar, SIDECAR } from "./sidecar";
import { openExternal } from "./openExternal";

// Base64-encode bytes without blowing the call stack on large attachments
// (String.fromCharCode(...bytes) overflows for multi-MB files). FileReader's
// data URL does the encoding natively, then we strip the "data:...;base64," head.
function bytesToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result as string;
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as BlobPart]));
  });
}

/**
 * Download in-memory bytes to a file via the sidecar handoff + system browser.
 * Returns the loopback URL that was opened, so the caller can offer a manual
 * "open in browser" fallback if the OS opener wasn't available.
 */
export async function downloadBytesViaSidecar(
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ url: string; opened: boolean }> {
  const dataB64 = await bytesToBase64(bytes);
  const { token } = await sidecar<{ token: string }>("/local-download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, contentType, dataB64 }),
  });
  const url = `${SIDECAR}/local-download/${token}`;
  const opened = await openExternal(url);
  return { url, opened };
}
