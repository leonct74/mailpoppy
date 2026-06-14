// Turn an error (usually thrown by the sidecar client) into a short, calm,
// user-facing sentence. The sidecar() helper throws `sidecar <status>: <body>`,
// where <body> is normally JSON like {"ok":false,"error":"…"} — we surface the
// inner message, never the raw envelope or a bare HTTP status. Network/helper
// failures are already friendly (see sidecar.ts) and pass through unchanged.
export function friendlyError(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;

  const m = raw.match(/^sidecar (\d{3}): ([\s\S]*)$/);
  if (!m) return raw; // already-friendly (network/helper text) or a plain message

  const [, status, body = ""] = m;
  let detail = body.trim();
  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) detail = parsed.error.trim();
  } catch {
    /* body wasn't JSON — keep the text */
  }

  if (detail) return detail;
  if (status === "404") return "That isn't available.";
  if (status === "403") return "You don't have permission to do that.";
  return fallback;
}
