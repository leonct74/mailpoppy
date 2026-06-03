// Open an external URL (e.g. a presigned S3 attachment download) from the
// webview. In the Tauri shell, window.open() is a no-op, so we route through the
// opener plugin to hand the URL to the OS (default browser). Outside Tauri
// (plain browser / tests) we fall back to window.open. The plugin is imported
// lazily so this module loads fine in non-Tauri environments.
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
}
