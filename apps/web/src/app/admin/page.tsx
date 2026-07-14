"use client";

// Free-access (comp) console — for MailPoppy's OWN operator (Olly Digital) to grant a domain the
// mobile/web apps for FREE, bypassing payment. Use it for your own domains and to comp other people
// (partners, testers, friends). It drives the existing admin API (POST /api/admin/domains), which is
// guarded server-side by HUB_ADMIN_TOKEN — you paste that token here once (kept only in this
// browser's localStorage, sent as a Bearer header; it never appears in a URL).
//
// A domain must be DEPLOYED first (the person runs MailPoppy for it, which registers it). Then you
// grant free access here and it's on — no subscription, forever, until you revoke it.
import { useCallback, useEffect, useState } from "react";

interface DomainState {
  domain: string;
  exists: boolean;
  manualEntitlement?: boolean;
  mobileActive?: boolean;
  accountId?: string | null;
  verified?: boolean;
  hasDeployment?: boolean;
}

const TOKEN_KEY = "mailpoppy.adminToken";

export default function AdminFreeAccessPage() {
  const [token, setToken] = useState("");
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<DomainState | null>(null);
  const [busy, setBusy] = useState<null | "check" | "grant" | "revoke">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (t) setToken(t);
  }, []);

  const authed = useCallback(
    (init?: RequestInit) => ({
      ...init,
      headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${token.trim()}` },
    }),
    [token],
  );

  function friendly(error: string | undefined, status: number): string {
    switch (error) {
      case "admin_disabled":
        return "Free access isn't enabled on the server — set HUB_ADMIN_TOKEN in the Hub's environment first.";
      case "unauthorized":
        return "That admin token is wrong.";
      case "invalid_domain":
        return "That doesn't look like a valid domain.";
      case "unknown_domain":
        return "This domain isn't deployed yet. Whoever manages it must set up MailPoppy for it first (from the desktop app), then you can grant free access.";
      default:
        return `Something went wrong (${error ?? status}).`;
    }
  }

  const check = async () => {
    const d = domain.trim().toLowerCase();
    if (!d) return;
    setBusy("check");
    setMsg(null);
    setState(null);
    try {
      const res = await fetch(`/api/admin/domains?domain=${encodeURIComponent(d)}`, authed());
      const j = (await res.json().catch(() => ({}))) as DomainState & { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: friendly(j.error, res.status) });
        return;
      }
      setState(j);
    } finally {
      setBusy(null);
    }
  };

  const setAccess = async (active: boolean) => {
    const d = domain.trim().toLowerCase();
    if (!d) return;
    setBusy(active ? "grant" : "revoke");
    setMsg(null);
    try {
      const res = await fetch(
        "/api/admin/domains",
        authed({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: d, active }) }),
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string; manualEntitlement?: boolean };
      if (!res.ok) {
        setMsg({ ok: false, text: friendly(j.error, res.status) });
        return;
      }
      setMsg({ ok: true, text: active ? `Free access ON for ${d}.` : `Free access OFF for ${d}.` });
      await check();
    } finally {
      setBusy(null);
    }
  };

  const saveToken = (v: string) => {
    setToken(v);
    if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_KEY, v.trim());
  };

  const input =
    "bg-surface-high border-hairline focus:border-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none";

  return (
    <main className="bg-bg text-text min-h-screen">
      <div className="mx-auto max-w-xl px-5 py-14">
        <span className="text-primary text-sm font-semibold tracking-wide uppercase">MailPoppy admin</span>
        <h1 className="text-heading mt-2 text-3xl font-bold tracking-tight">Free access</h1>
        <p className="text-muted mt-3 text-sm leading-relaxed">
          Give a domain the mobile &amp; web apps for free — for your own domains, or to comp partners and testers.
          The domain has to be deployed first (its owner sets up MailPoppy for it); then switch it on here.
        </p>

        {/* Admin token */}
        <div className="border-hairline bg-surface mt-8 rounded-2xl border p-5">
          <label className="text-heading text-sm font-semibold">Admin token</label>
          <p className="text-dim mt-1 mb-2 text-xs">
            The <code>HUB_ADMIN_TOKEN</code> from the Hub&apos;s environment. Stored only in this browser.
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => saveToken(e.target.value)}
            placeholder="paste HUB_ADMIN_TOKEN"
            className={input}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Domain lookup + actions */}
        <div className="border-hairline bg-surface mt-4 rounded-2xl border p-5">
          <label className="text-heading text-sm font-semibold">Domain</label>
          <div className="mt-2 flex gap-2">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="acme.com"
              className={input}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(e) => e.key === "Enter" && void check()}
            />
            <button
              type="button"
              onClick={() => void check()}
              disabled={!token.trim() || !domain.trim() || busy !== null}
              className="border-hairline bg-surface-high text-text shrink-0 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"
            >
              {busy === "check" ? "…" : "Check"}
            </button>
          </div>

          {state && (
            <div className="border-hairline bg-bg-elevated mt-4 rounded-xl border p-4 text-sm">
              {!state.exists ? (
                <p className="text-muted">
                  <b className="text-text">{state.domain}</b> isn&apos;t deployed yet. Its owner needs to set up
                  MailPoppy for it first, then you can grant free access.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Free access (comp)</span>
                    <span className={state.manualEntitlement ? "text-primary font-semibold" : "text-dim"}>
                      {state.manualEntitlement ? "ON" : "off"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted">Paid (subscription)</span>
                    <span className="text-dim">{state.mobileActive ? "active" : "—"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted">Deployed backend</span>
                    <span className="text-dim">{state.hasDeployment ? "yes" : "no"}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void setAccess(true)}
                      disabled={busy !== null || state.manualEntitlement === true}
                      className="bg-primary text-primary-text flex-1 rounded-lg py-2 text-sm font-bold disabled:opacity-50"
                    >
                      {busy === "grant" ? "…" : "Grant free access"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void setAccess(false)}
                      disabled={busy !== null || !state.manualEntitlement}
                      className="border-hairline text-text rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {busy === "revoke" ? "…" : "Revoke"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-primary" : "text-danger"}`}>{msg.text}</p>}
        </div>

        <p className="text-dim mt-6 text-xs leading-relaxed">
          Free access sets the domain&apos;s <code>manualEntitlement</code> flag — it&apos;s honoured regardless of any
          subscription, and Stripe reconciliation never clears it. Revoke it here anytime.
        </p>
      </div>
    </main>
  );
}
