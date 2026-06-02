// Read a browser File into the SendAttachment shape (base64) the access API
// expects. Works in the Tauri webview and (via the same Web APIs) React Native.
import type { SendAttachment } from "./mailClient";

export function fileToAttachment(file: File): Promise<SendAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.onload = () => {
      // readAsDataURL → "data:<type>;base64,<data>"; keep just the base64 payload.
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        filename: file.name || "attachment",
        contentType: file.type || "application/octet-stream",
        contentBase64: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function filesToAttachments(files: FileList | File[]): Promise<SendAttachment[]> {
  return Promise.all(Array.from(files).map(fileToAttachment));
}
