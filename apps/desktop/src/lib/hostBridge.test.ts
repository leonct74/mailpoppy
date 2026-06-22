import { describe, it, expect, vi, afterEach } from "vitest";
import { invokeBackend } from "./hostBridge";

afterEach(() => vi.restoreAllMocks());

/**
 * Drive the guest bridge against a fake host: capture the posted HostRequest, then
 * dispatch the correlated HostResponse back on `window` (as the host's iframe wiring
 * does). jsdom is top-level, so we post to window.parent === window.
 */
function fakeHost(reply: (req: { id: string; method: string; params: unknown[] }) => unknown, ok = true) {
  vi.spyOn(window, "postMessage").mockImplementation(((msg: unknown) => {
    const req = msg as { id: string; method: string; params: unknown[] };
    queueMicrotask(() => {
      const body = reply(req);
      const res = ok ? { id: req.id, ok: true, result: body } : { id: req.id, ok: false, error: body as string };
      window.dispatchEvent(new MessageEvent("message", { data: res }));
    });
  }) as typeof window.postMessage);
}

describe("hostBridge guest", () => {
  it("invokeBackend round-trips the request and resolves the parsed result", async () => {
    let seen: { method: string; path: string; body?: unknown } | undefined;
    fakeHost((req) => {
      seen = req.params[0] as typeof seen;
      return { ok: true, n: 7 };
    });
    const out = await invokeBackend<{ ok: boolean; n: number }>({ method: "POST", path: "/deploy", body: { x: 1 } });
    expect(out).toEqual({ ok: true, n: 7 });
    expect(seen).toEqual({ method: "POST", path: "/deploy", body: { x: 1 } });
  });

  it("rejects with the host's error string on failure", async () => {
    fakeHost(() => "backend 404: {\"error\":\"nope\"}", false);
    await expect(invokeBackend({ method: "GET", path: "/x" })).rejects.toThrow(/backend 404/);
  });
});
