"use client";

// The admin billing dashboard. Sign in with a MailPoppy account (email/password or Google),
// see the domains you own and their live subscription status, and turn the apps on/off per
// domain. Activation goes through Stripe; "Manage billing" opens the Stripe portal.
//
// State comes from /api/account, but a completed first-domain payment only flips mobileActive
// via the Stripe webhook — so after checkout (and on a manual "Sync"), we call
// /api/account/reconcile, which pulls the truth straight from Stripe. That makes the dashboard
// self-healing even if the webhook is slow, unregistered, or failed.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/hub/firebaseClient";
import { Logo } from "@/components/webmail/Logo";
import {
  DevicesIcon,
  GlobeIcon,
  CheckCircleIcon,
  ShieldIcon,
  ClockIcon,
} from "@/components/webmail/icons";

interface DomainRow {
  domain: string;
  mobileActive: boolean;
  /** Admin comp — entitled with no Stripe seat; shown as active, not offered a charge button. */
  manualEntitlement?: boolean;
  /** Paid through AgentsPoppy's in-app purchase (the current model) — shown as active; billing is
   *  managed in the app, so no legacy charge/turn-off here. */
  agentspoppyEntitled?: boolean;
  verified: boolean;
}
interface AccountData {
  email: string;
  subscriptionStatus: string;
  currentPeriodEnd: number | null;
  cancelAt: number | null;
  domains: DomainRow[];
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "You already have an account with this email — sign in with your email and password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password doesn't match.";
    case "auth/email-already-in-use":
      return "That email already has an account — sign in instead.";
    case "auth/weak-password":
      return "Pick a password with at least 6 characters.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/api-key-not-valid":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "Login isn't configured correctly (Firebase API key). Check the NEXT_PUBLIC_FIREBASE_* settings.";
    default:
      return (e as { message?: string })?.message ?? "Couldn't sign you in.";
  }
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** The account's plan standing, reduced to one banner (tone drives the colour). */
function planSummary(d: AccountData | null): { tone: "on" | "warn" | "off"; title: string; sub: string } {
  const status = d?.subscriptionStatus ?? "none";
  if (d?.cancelAt) {
    return { tone: "warn", title: "Scheduled to cancel", sub: `Access stays on until ${fmtDate(d.cancelAt)}.` };
  }
  switch (status) {
    case "active":
      return {
        tone: "on",
        title: "Subscription active",
        sub: d?.currentPeriodEnd ? `Renews automatically on ${fmtDate(d.currentPeriodEnd)}.` : "Your plan is live.",
      };
    case "trialing":
      return {
        tone: "on",
        title: "Trial active",
        sub: d?.currentPeriodEnd ? `Your trial runs until ${fmtDate(d.currentPeriodEnd)}.` : "Your trial is live.",
      };
    case "past_due":
      return { tone: "warn", title: "Payment past due", sub: "Update your card in “Manage billing” to keep access." };
    case "canceled":
      return { tone: "off", title: "Subscription ended", sub: "Set up mobile access from the MailPoppy desktop app." };
    default:
      return { tone: "off", title: "No legacy plan", sub: "Mobile access is set up in the MailPoppy desktop app now." };
  }
}

export default function AccountPage() {
  const auth = getClientAuth();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [justActivated, setJustActivated] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, [auth]);

  // Surface a Google redirect-fallback error (unauthorised domain / provider disabled) if any.
  useEffect(() => {
    if (!auth) return;
    getRedirectResult(auth).catch((err) => {
      const msg = friendlyAuthError(err);
      if (msg) setFormErr(msg);
    });
  }, [auth]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("activated");
    if (p) {
      setJustActivated(p);
      window.history.replaceState(null, "", "/account");
    }
  }, []);

  const load = useCallback(async () => {
    const u = auth?.currentUser;
    if (!u) return;
    setLoading(true);
    setError(null);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/account", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as AccountData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your account.");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  // Pull the true state from Stripe and write it through, so a completed payment shows up even
  // when the webhook hasn't. Falls back to a plain load if reconcile itself fails.
  const reconcile = useCallback(
    async (domain?: string) => {
      const u = auth?.currentUser;
      if (!u) return;
      setSyncing(true);
      setError(null);
      try {
        const token = await u.getIdToken();
        const res = await fetch("/api/account/reconcile", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: domain ? JSON.stringify({ domain }) : undefined,
        });
        const j = (await res.json().catch(() => ({}))) as AccountData & { error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        setData(j);
      } catch {
        await load(); // never leave the dashboard blank because a sync hiccuped
      } finally {
        setSyncing(false);
      }
    },
    [auth, load],
  );

  // Reconcile against Stripe whenever a signed-in dashboard loads, so the status shown is always
  // the real one — self-healing even when the webhook never ran. onAuthStateChanged drives this;
  // reconcile falls back to a plain load() if the sync itself fails.
  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }
    void reconcile();
  }, [user, reconcile]);

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setSubmitting(true);
    setFormErr(null);
    try {
      if (mode === "signin") await signInWithEmailAndPassword(auth, email.trim(), password);
      else await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setFormErr(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    if (!auth) return;
    setSubmitting(true);
    setFormErr(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (e2) {
          setFormErr(friendlyAuthError(e2));
        }
      } else {
        setFormErr(friendlyAuthError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function act(path: string, domain?: string) {
    const u = auth?.currentUser;
    if (!u) return;
    setBusy(domain ?? "portal");
    setError(null);
    try {
      const token = await u.getIdToken();
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: domain ? JSON.stringify({ domain }) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  // --- render -------------------------------------------------------------

  if (!authReady) {
    return (
      <Shell>
        <p className="text-dim">Loading…</p>
      </Shell>
    );
  }

  if (!auth) {
    return (
      <Shell>
        <Logo size="sm" />
        <p className="text-dim mt-8">
          Sign-in isn&apos;t configured yet. Set the <code>NEXT_PUBLIC_FIREBASE_*</code> values and rebuild.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <Logo size="sm" />
        <div className="mt-10 max-w-sm">
          <h1 className="text-heading text-3xl font-bold tracking-tight">Your MailPoppy account</h1>
          <p className="text-muted mt-2">Sign in to manage the apps for your domains.</p>
          <div className="border-hairline bg-surface mt-6 space-y-4 rounded-2xl border p-5">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={submitting}
              className="border-hairline bg-surface-high text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <GoogleGlyph />
              Continue with Google
            </button>
            <div className="flex items-center gap-3">
              <span className="border-hairline h-px flex-1 border-t" />
              <span className="text-dim text-xs font-medium">or with email</span>
              <span className="border-hairline h-px flex-1 border-t" />
            </div>
            <form onSubmit={submitLogin} className="space-y-3">
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@yourdomain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-surface-high border-hairline focus:border-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              />
              <input
                type="password"
                required
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-surface-high border-hairline focus:border-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
              />
              {formErr && <p className="text-danger text-sm">{formErr}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="bg-primary text-primary-text w-full rounded-xl py-2.5 text-sm font-bold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setFormErr(null);
              }}
              className="text-dim hover:text-text w-full text-center text-sm"
            >
              {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const status = data?.subscriptionStatus ?? "none";
  const plan = planSummary(data);
  const planTone =
    plan.tone === "on"
      ? "border-primary/30 bg-primary/[0.07]"
      : plan.tone === "warn"
        ? "border-danger/30 bg-danger/[0.06]"
        : "border-hairline bg-surface";
  const activeCount = data?.domains.filter((d) => d.mobileActive || d.manualEntitlement).length ?? 0;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Logo size="sm" />
          <h1 className="text-heading mt-4 text-3xl font-bold tracking-tight">Mobile &amp; web access</h1>
          <p className="text-dim mt-1 text-sm">{data?.email || user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void reconcile()}
            disabled={syncing}
            className="border-hairline text-muted hover:bg-surface-variant hover:text-text rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-60"
            title="Pull the latest status from Stripe"
          >
            {syncing ? "Syncing…" : "Sync status"}
          </button>
          {status !== "none" && (
            <button
              onClick={() => act("/api/account/portal")}
              disabled={busy === "portal"}
              className="border-hairline text-text hover:bg-surface-variant rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-60"
            >
              {busy === "portal" ? "…" : "Manage billing"}
            </button>
          )}
          <button onClick={() => signOut(auth)} className="text-dim hover:text-text rounded-lg px-3 py-1.5 text-sm">
            Sign out
          </button>
        </div>
      </div>

      {/* Plan status banner */}
      <div className={`mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${planTone}`}>
        <div className="flex items-start gap-3">
          <span className={plan.tone === "warn" ? "text-danger" : plan.tone === "on" ? "text-primary" : "text-dim"}>
            {plan.tone === "warn" ? <ClockIcon size={22} /> : <ShieldIcon size={22} />}
          </span>
          <div>
            <div className="text-text font-bold">{plan.title}</div>
            <div className="text-muted mt-0.5 text-sm">{plan.sub}</div>
          </div>
        </div>
        {(status === "active" || status === "trialing") && (
          <span className="text-muted text-sm">
            {activeCount} {activeCount === 1 ? "domain" : "domains"} on
          </span>
        )}
      </div>

      {justActivated && (
        <p className="border-primary/30 bg-primary/[0.07] text-text mt-4 flex items-center gap-2 rounded-xl border p-3 text-sm">
          <span className="text-primary">
            <CheckCircleIcon size={16} />
          </span>
          Payment received — confirming <b>{justActivated}</b>{syncing ? "…" : ". It should be on below now."}
        </p>
      )}
      {data?.cancelAt && (
        <div className="border-danger/30 bg-danger/[0.06] mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm">
          <span className="text-text">
            Your subscription will cancel on <b>{fmtDate(data.cancelAt)}</b> — access stays on until then.
          </span>
          <button
            onClick={() => act("/api/account/resume")}
            disabled={busy === "portal"}
            className="border-hairline text-text hover:bg-surface-variant shrink-0 rounded-lg border px-3 py-1.5 disabled:opacity-60"
          >
            {busy === "portal" ? "…" : "Keep my subscription"}
          </button>
        </div>
      )}

      {error && <p className="text-danger mt-4 text-sm">{error}</p>}

      {/* Domains */}
      <h2 className="text-heading mt-8 text-sm font-bold tracking-wide uppercase">Your domains</h2>
      <div className="mt-3 space-y-2.5">
        {loading && !data && <p className="text-dim">Loading…</p>}
        {data && data.domains.length === 0 && (
          <div className="border-hairline bg-surface text-muted rounded-2xl border p-6 text-sm leading-relaxed">
            No domains yet. Set up a domain in the <b className="text-text">MailPoppy desktop app</b> first, then come
            back here to switch on the apps for it.
          </div>
        )}
        {data?.domains.map((d) => {
          const on = d.mobileActive || d.manualEntitlement || d.agentspoppyEntitled;
          return (
            <div
              key={d.domain}
              className="border-hairline bg-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 ${on ? "text-primary" : "text-dim"}`}>
                  <GlobeIcon size={20} />
                </span>
                <div>
                  <div className="text-text font-semibold">{d.domain}</div>
                  <div className="text-dim text-xs">
                    {on
                      ? "Everyone with a mailbox here can use the mobile & web apps"
                      : "The apps are off for this domain"}
                  </div>
                </div>
              </div>
              {d.manualEntitlement ? (
                // Admin comp: entitled with no Stripe seat — show it as on, but no charge/turn-off.
                <span
                  className="bg-primary/15 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                  title="Complimentary access granted by MailPoppy — no charge"
                >
                  <CheckCircleIcon size={13} /> Active · complimentary
                </span>
              ) : d.agentspoppyEntitled ? (
                // Paid through the app's in-app purchase — billing is managed there, not here.
                <span
                  className="bg-primary/15 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                  title="Paid through the MailPoppy app — manage billing in the app"
                >
                  <CheckCircleIcon size={13} /> Active
                </span>
              ) : d.mobileActive ? (
                // Legacy Stripe subscription (pre-migration) — kept working; manage it in the portal.
                <div className="flex items-center gap-3">
                  <span className="bg-primary/15 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
                    <CheckCircleIcon size={13} /> Active
                  </span>
                  <button
                    onClick={() => act("/api/account/deactivate", d.domain)}
                    disabled={busy === d.domain}
                    className="text-dim hover:text-danger text-sm disabled:opacity-60"
                  >
                    {busy === d.domain ? "…" : "Turn off"}
                  </button>
                </div>
              ) : (
                // Off — set up mobile access in the DESKTOP APP (AgentsPoppy in-app purchase). No
                // charge button here: the old Stripe checkout is retired, and reviving it would risk
                // paying twice for a domain already bought in the app.
                <span className="text-dim text-sm">Set it up in the app</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-dim mt-6 flex items-center gap-1.5 text-xs">
        <DevicesIcon size={13} />
        Paid once per domain — everyone with a mailbox on an active domain signs in on iPhone, Android and the web.
      </p>
    </Shell>
  );
}

/** The multi-colour Google "G" (inlined so we ship no external asset). */
function GoogleGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.6 34.6 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.6 5.6C41.9 35.9 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-bg text-text relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="bg-primary-bright pointer-events-none absolute -top-40 left-1/2 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full opacity-[0.07] blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">{children}</div>
    </main>
  );
}
