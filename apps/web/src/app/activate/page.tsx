"use client";

// The activation funnel the desktop app links to ("See the pricing"). It carries a domain + its
// PUBLIC backend config in the URL. Here the admin sees the price, what the service is, and the
// terms; signs in or signs up (email/password or Google); and subscribes. On sign-in we register
// the domain with the Hub so it's bound + resolvable; on checkout success we confirm it's live and
// point at the apps.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/hub/firebaseClient";
import { Logo } from "@/components/webmail/Logo";
import {
  DevicesIcon,
  GlobeIcon,
  BoltIcon,
  LockIcon,
  ShieldIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from "@/components/webmail/icons";

interface PriceInfo {
  amount: number | null;
  currency: string;
  interval: string | null;
  intervalCount: number;
}
interface Deployment {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    // The user dismissed the Google popup — not an error worth shouting about.
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/account-exists-with-different-credential":
      return "You already have an account with this email — sign in with your email and password instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password doesn't match.";
    case "auth/email-already-in-use":
      return "That email already has an account — switch to Sign in.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    default:
      return (e as { message?: string })?.message ?? "Couldn't sign you in.";
  }
}

function formatPrice(p: PriceInfo | null): string | null {
  if (!p || p.amount == null) return null;
  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: (p.currency || "usd").toUpperCase(),
  }).format(p.amount / 100);
  if (!p.interval) return money;
  const every = p.intervalCount > 1 ? `${p.intervalCount} ${p.interval}s` : p.interval;
  return `${money} / ${every}`;
}

// Plain words for the billing cycle, derived from the real Stripe price so the terms can't drift.
function billingCadence(p: PriceInfo | null): string {
  if (!p?.interval) return "";
  if (p.intervalCount > 1) return `every ${p.intervalCount} ${p.interval}s`;
  return p.interval === "year" ? "yearly" : p.interval === "month" ? "monthly" : `per ${p.interval}`;
}
function periodNoun(p: PriceInfo | null): string {
  if (!p?.interval) return "period";
  return p.intervalCount > 1 ? `${p.intervalCount} ${p.interval}s` : p.interval; // "year" | "month"
}
function renewWord(p: PriceInfo | null): string {
  if (!p?.interval) return "each period";
  if (p.intervalCount > 1) return `every ${p.intervalCount} ${p.interval}s`;
  return p.interval === "year" ? "each year" : p.interval === "month" ? "each month" : `each ${p.interval}`;
}

export default function ActivatePage() {
  const auth = getClientAuth();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [domain, setDomain] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [activated, setActivated] = useState<string | null>(null);
  const [activeDomains, setActiveDomains] = useState<string[]>([]);

  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const registeredRef = useRef(false);

  // Parse the URL (domain + base64 deployment + post-checkout flag).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDomain(q.get("domain"));
    setActivated(q.get("activated"));
    const dep = q.get("dep");
    if (dep) {
      try {
        setDeployment(JSON.parse(atob(dep)) as Deployment);
      } catch {
        /* ignore malformed */
      }
    }
  }, []);

  useEffect(() => {
    fetch("/api/price")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => p && setPrice(p as PriceInfo))
      .catch(() => {});
  }, []);

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

  // Once signed in with a domain to bind, register it (idempotent) so it's resolvable + appears
  // on the dashboard even before checkout.
  const ensureRegistered = useCallback(async () => {
    const u = auth?.currentUser;
    if (!u || !domain || !deployment || registeredRef.current) return;
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/deployments/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domain, ...deployment }),
      });
      if (res.ok) registeredRef.current = true;
    } catch {
      /* best-effort; subscribe re-tries */
    }
  }, [auth, domain, deployment]);

  useEffect(() => {
    if (user) void ensureRegistered();
  }, [user, ensureRegistered]);

  // On the post-checkout screen, list the account's active domains for the confirmation copy.
  useEffect(() => {
    if (!activated || !user) return;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/account", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = (await res.json()) as { domains?: { domain: string; mobileActive?: boolean }[] };
        setActiveDomains((data.domains ?? []).filter((d) => d.mobileActive).map((d) => d.domain));
      } catch {
        /* ignore */
      }
    })();
  }, [activated, user]);

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
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setFormErr(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function subscribe() {
    const u = auth?.currentUser;
    if (!u || !domain) return;
    setBusy(true);
    setError(null);
    try {
      await ensureRegistered();
      const token = await u.getIdToken();
      const res = await fetch("/api/account/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domain, returnTo: "/activate" }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      window.location.href = `/activate?activated=${encodeURIComponent(domain)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
    } finally {
      setBusy(false);
    }
  }

  const priceLabel = formatPrice(price);

  // --- success screen (post-checkout) -------------------------------------
  if (activated) {
    const others = activeDomains.filter((d) => d !== activated);
    return (
      <Shell>
        <Glow />
        <div className="relative mx-auto max-w-xl text-center">
          <Logo size="lg" className="mx-auto" />
          <div className="border-hairline bg-surface-container mt-8 rounded-3xl border p-8 sm:p-10">
            <div className="text-4xl">🎉</div>
            <h1 className="text-heading mt-3 text-3xl font-bold tracking-tight">You&apos;re all set</h1>
            <p className="text-text mt-4 leading-relaxed">
              The MailPoppy app is now switched on for{" "}
              <b className="text-heading">{activated}</b>
              {others.length > 0 && (
                <>
                  {" "}
                  and <b className="text-heading">{others.join(", ")}</b>
                </>
              )}
              . Everyone with a mailbox there can sign in on iPhone, Android and the web.
            </p>
            {others.length > 0 && (
              <p className="text-muted mt-3 text-sm leading-relaxed">
                All {others.length + 1} of your domains live in the same app — anyone with mailboxes across them
                switches between them in a tap.
              </p>
            )}
            <div className="border-hairline bg-bg-elevated mt-7 rounded-2xl border p-5 text-left">
              <div className="text-heading flex items-center gap-2 text-sm font-bold">
                <span className="text-primary">
                  <DevicesIcon size={16} />
                </span>
                Get the app
              </div>
              <p className="text-muted mt-1.5 text-sm leading-relaxed">
                Sign in with your mailbox email and password. The MailPoppy app is{" "}
                <b className="text-text">coming soon</b> to the App Store and Google Play.
              </p>
            </div>
            <a
              href="/account"
              className="text-primary mt-6 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            >
              Manage your domains
              <ArrowRightIcon size={14} />
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  const benefits: { icon: typeof DevicesIcon; title: string; body: string }[] = [
    {
      icon: DevicesIcon,
      title: domain ? `One app for everyone on ${domain}` : "One app for everyone on your domain",
      body: "Every mailbox on the domain signs in to the MailPoppy app for iPhone, Android and the web — one price covers them all, with no per-person fee.",
    },
    {
      icon: GlobeIcon,
      title: "Run several domains? One app holds them all",
      body: "Activate each domain you run and they live side by side in the same app. Anyone with mailboxes across them switches in a tap — made for people shipping multiple products, each on its own domain.",
    },
    {
      icon: BoltIcon,
      title: "Native push the moment mail lands",
      body: "Real notifications with sender and subject. Tap one and land straight on that message, in the right mailbox.",
    },
    {
      icon: LockIcon,
      title: "Your mail never leaves your AWS",
      body: "The app only connects to the backend in your own account. We never see, store or route your email — activation just unlocks the apps.",
    },
  ];

  return (
    <Shell>
      <Glow />
      <div className="relative">
        <Logo size="sm" />

        {/* Hero */}
        <div className="mt-10 max-w-2xl">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Activate the mobile app</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Take {domain ? <span className="text-primary">{domain}</span> : "your email"} everywhere.
          </h1>
          {domain ? (
            <p className="text-muted mt-4 text-lg leading-relaxed">
              Switch on the MailPoppy app for <b className="text-text">{domain}</b> — so everyone with a mailbox here
              reads, replies and gets push notifications from their phone.
            </p>
          ) : (
            <p className="text-muted mt-4 text-lg leading-relaxed">
              Open this page from the <b className="text-text">MailPoppy desktop app</b> — one tap on “Take it mobile”
              brings your domain here, ready to activate.
            </p>
          )}
        </div>

        {/* Benefits (left) + pricing & auth card (right) */}
        <div className="mt-10 grid gap-8 lg:grid-cols-5 lg:items-start">
          {/* Pricing + auth — first on mobile so the action is reachable, right column on desktop. */}
          <div className="order-1 lg:order-2 lg:col-span-2 lg:sticky lg:top-8">
            <div className="border-primary/30 bg-surface-high rounded-3xl border p-7 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <span className="text-primary text-xs font-semibold tracking-wide uppercase">Mobile &amp; web apps</span>
                <span className="border-hairline bg-surface text-muted rounded-full border px-2.5 py-1 text-[11px] font-semibold">
                  per domain
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-heading text-4xl font-bold">{priceLabel ?? "Coming soon"}</span>
              </div>
              <p className="text-muted mt-2 text-sm leading-relaxed">
                {billingCadence(price) ? `Billed ${billingCadence(price)}, ` : ""}per domain, paid by you — the people
                with mailboxes never see a bill.
              </p>

              <ul className="mt-5 space-y-2.5">
                {[
                  "Everyone on this domain gets the mobile & web apps",
                  `Renews automatically ${renewWord(price)} — cancel anytime`,
                  `Keep access to the end of the ${periodNoun(price)} you've paid for`,
                  "Your mail keeps running in your own AWS",
                ].map((t) => (
                  <li key={t} className="text-text flex items-start gap-2.5 text-sm leading-relaxed">
                    <span className="text-primary mt-0.5 shrink-0">
                      <CheckCircleIcon size={16} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>

              {error && <p className="text-danger mt-5 text-sm">{error}</p>}

              {/* Auth + subscribe */}
              <div className="mt-6">
                {!authReady ? (
                  <p className="text-dim text-sm">Loading…</p>
                ) : !auth ? (
                  <p className="text-dim text-sm">
                    Sign-in isn&apos;t configured. Set the NEXT_PUBLIC_FIREBASE_* values.
                  </p>
                ) : !user ? (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      disabled={submitting}
                      className="border-hairline bg-surface text-text hover:bg-surface-variant flex w-full items-center justify-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60"
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
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-surface-high border-hairline focus:border-primary w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                      />
                      <input
                        type="password"
                        required
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        placeholder={mode === "signup" ? "Choose a password (6+ characters)" : "Password"}
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
                        {submitting ? "…" : mode === "signup" ? "Create account & continue" : "Sign in & continue"}
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => {
                        setMode(mode === "signup" ? "signin" : "signup");
                        setFormErr(null);
                      }}
                      className="text-dim hover:text-text w-full text-center text-sm"
                    >
                      {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => void subscribe()}
                      disabled={busy || !domain}
                      className="bg-primary text-primary-text flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busy ? "Starting checkout…" : priceLabel ? `Subscribe — ${priceLabel}` : "Subscribe"}
                      {!busy && <ArrowRightIcon size={16} />}
                    </button>
                    <p className="text-dim mt-2.5 text-center text-xs">
                      Signed in as {user.email ?? "your account"}. Secure checkout via Stripe.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className="text-dim mt-3 flex items-center justify-center gap-1.5 text-center text-xs">
              <span className="text-primary">
                <ShieldIcon size={12} />
              </span>
              We never see your mail — activation only unlocks the apps.
            </p>
          </div>

          {/* Why it's worth it — the multi-domain story. */}
          <div className="order-2 lg:order-1 lg:col-span-3">
            <div className="grid gap-4 sm:grid-cols-2">
              {benefits.map((b) => (
                <div key={b.title} className="border-hairline bg-surface rounded-2xl border p-5">
                  <div className="bg-primary/12 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
                    <b.icon size={20} />
                  </div>
                  <h3 className="text-text mt-3.5 text-sm font-bold">{b.title}</h3>
                  <p className="text-muted mt-1.5 text-sm leading-relaxed">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** Ambient crimson glow, matching the marketing hero. */
function Glow() {
  return (
    <div
      aria-hidden
      className="bg-primary-bright pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full opacity-[0.08] blur-3xl"
    />
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
      <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">{children}</div>
    </main>
  );
}
