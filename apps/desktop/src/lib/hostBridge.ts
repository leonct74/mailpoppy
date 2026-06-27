// AgentsPoppy host bridge — GUEST side.
//
// When MailPoppy runs as an extension INSIDE the AgentsPoppy container it lives in a
// sandboxed iframe with no network access to its own sidecar (opaque origin). Backend
// calls are instead proxied to the host over postMessage; the host services them
// against the sidecar process it spawned for this connection and gates them on
// MailPoppy's manifest-declared capabilities.
//
// This is a tiny, self-contained mirror of @agentspoppy/extension-sdk's bridge (no
// cross-repo build dependency — same approach as agentspoppyBroker.ts in the sidecar).
// Standalone (the normal Tauri window), none of this is used: sidecar() fetches the
// loopback sidecar directly.

interface HostRequest {
  id: string;
  method: string;
  params: unknown[];
}
type HostResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

/**
 * True when MailPoppy is running inside the AgentsPoppy container (an iframe) rather
 * than as the standalone top-level Tauri window. A cross-origin access throw also
 * means we're framed, so treat it as container mode.
 */
export function inAgentsPoppyContainer(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// A generous cap so a long-running backend call (e.g. a deploy that polls AWS) isn't
// killed mid-flight; it only fires if the host genuinely never answers.
const BRIDGE_TIMEOUT_MS = 15 * 60 * 1000;

let seq = 0;
let wired = false;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function ensureWired(): void {
  if (wired) return;
  wired = true;
  window.addEventListener("message", (e: MessageEvent) => {
    const res = e.data as Partial<HostResponse> | null;
    if (!res || typeof res.id !== "string" || typeof (res as HostResponse).ok !== "boolean") return;
    const p = pending.get(res.id);
    if (!p) return; // unknown / duplicate correlation id
    pending.delete(res.id);
    clearTimeout(p.timer);
    if ((res as { ok: boolean }).ok) p.resolve((res as { result: unknown }).result);
    else p.reject(new Error((res as { error: string }).error));
  });
}

function callHost<T>(method: string, params: unknown[]): Promise<T> {
  ensureWired();
  return new Promise<T>((resolve, reject) => {
    const id = `mp-${Date.now().toString(36)}-${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("AGENTSPOPPY_BRIDGE_TIMEOUT"));
    }, BRIDGE_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    (window.parent ?? window).postMessage({ id, method, params } as HostRequest, "*");
  });
}

/** Proxy a backend call to MailPoppy's sidecar via the host. Resolves the parsed JSON body. */
export function invokeBackend<T>(req: { method: string; path: string; body?: unknown }): Promise<T> {
  return callHost<T>("invokeBackend", [req]);
}

/**
 * Ask the host to open a URL in the OS browser (gated by the `host:openExternal`
 * capability). Inside the container the iframe can't open OS windows itself
 * (window.open is a no-op in the host webview, no Tauri opener in the frame), so this
 * is how a presigned attachment URL / external link actually reaches the browser.
 */
export function openExternalViaHost(url: string): Promise<void> {
  return callHost<void>("openExternal", [url]);
}
