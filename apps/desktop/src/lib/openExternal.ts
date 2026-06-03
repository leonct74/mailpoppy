// Open an external URL (e.g. a presigned S3 attachment download) from the
// webview. In the Tauri shell, window.open() is a no-op, so we route through the
// opener plugin to hand the URL to the OS (default browser). Outside Tauri
// (plain browser / tests) we fall back to window.open. The plugin is imported
// lazily so this module loads fine in non-Tauri environments.
//
// Returns true if the URL was actually handed off (Tauri opener succeeded, or a
// browser window opened). Returns false when nothing could open it — e.g. a
// Tauri build whose opener plugin isn't active yet (needs a full app restart);
// callers should then surface the link so the user is never stuck.
export async function openExternal(url: string): Promise<boolean> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch {
    try {
      const w =
        typeof window !== "undefined" && typeof window.open === "function"
          ? window.open(url, "_blank", "noopener,noreferrer")
          : null;
      return !!w;
    } catch {
      return false;
    }
  }
}
