"use client";

// The "Update mobile settings" page the desktop app opens for a domain. MailPoppy's paywall now
// lives IN THE APP (the AgentsPoppy in-app purchase), so this page NO LONGER sells a subscription.
// Its only jobs: sign the admin in, RE-REGISTER the domain's live backend config with the Hub (which
// fixes a stale config after a redeploy so mobile/web sign-in keeps working), and show whether mobile
// access is on — using the authoritative resolve gate (which honours AgentsPoppy purchases, admin
// comps, the seed, and legacy access). Purchases happen in the desktop app, never here.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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

interface Deployment {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
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

export default function ActivatePage() {
  const auth = getClientAuth();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [domain, setDomain] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  // Entitlement of THIS domain, from the authoritative resolve gate (200 = on by any means:
  // AgentsPoppy purchase, admin comp, the seed, or legacy). Drives the confirmation vs. "set up in
  // the app" copy — never a subscribe button.
  const [status, setStatus] = useState<"checking" | "active" | "inactive">("checking");

  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const registeredRef = useRef(false);

  // Parse the URL (domain + base64 deployment).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setDomain(q.get("domain"));
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
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, [auth]);

  // Surface a Google redirect-sign-in error (the success lands via onAuthStateChanged).
  useEffect(() => {
    if (!auth) return;
    getRedirectResult(auth).catch((err) => {
      const msg = friendlyAuthError(err);
      if (msg) setFormErr(msg);
    });
  }, [auth]);

  // Re-register the domain's LIVE backend config (idempotent) so it's resolvable + fresh after a
  // redeploy. Needs the signed-in admin's token (a domain is owned by one account).
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
      /* best-effort */
    }
  }, [auth, domain, deployment]);

  // Once signed in: re-register the live config, then read the domain's entitlement from the
  // authoritative resolve gate (covers AgentsPoppy purchase / comp / seed / legacy).
  useEffect(() => {
    if (!user || !domain) return;
    setStatus("checking");
    void (async () => {
      await ensureRegistered();
      try {
        const res = await fetch(`/api/resolve?domain=${encodeURIComponent(domain)}`, { cache: "no-store" });
        setStatus(res.ok ? "active" : "inactive");
      } catch {
        setStatus("inactive");
      }
    })();
  }, [user, domain, ensureRegistered]);

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

  const benefits: { icon: typeof DevicesIcon; title: string; body: string }[] = [
    {
      icon: DevicesIcon,
      title: domain ? `One app for everyone on ${domain}` : "One app for everyone on your domain",
      body: "Every mailbox on the domain signs in to the MailPoppy app for iPhone, Android and the web — no per-person fee.",
    },
    {
      icon: GlobeIcon,
      title: "Run several domains? One app holds them all",
      body: "Each domain you run lives side by side in the same app. Anyone with mailboxes across them switches in a tap.",
    },
    {
      icon: BoltIcon,
      title: "Native push the moment mail lands",
      body: "Real notifications with sender and subject. Tap one and land straight on that message, in the right mailbox.",
    },
    {
      icon: LockIcon,
      title: "Your mail never leaves your AWS",
      body: "The app only connects to the backend in your own account. We never see, store or route your email.",
    },
  ];

  return (
    <Shell>
      <Glow />
      <div className="relative">
        <Logo size="sm" />

        {/* Hero */}
        <div className="mt-10 max-w-2xl">
          <span className="text-primary text-sm font-semibold tracking-wide uppercase">Mobile app settings</span>
          <h1 className="text-heading mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Take {domain ? <span className="text-primary">{domain}</span> : "your email"} everywhere.
          </h1>
          {domain ? (
            <p className="text-muted mt-4 text-lg leading-relaxed">
              Sign in to refresh the mobile &amp; web app settings for <b className="text-text">{domain}</b> — so
              everyone with a mailbox here can keep signing in from their phone.
            </p>
          ) : (
            <p className="text-muted mt-4 text-lg leading-relaxed">
              Open this page from the <b className="text-text">MailPoppy desktop app</b> to bring your domain here.
            </p>
          )}
        </div>

        {/* Benefits (left) + sign-in / status card (right) */}
        <div className="mt-10 grid gap-8 lg:grid-cols-5 lg:items-start">
          <div className="order-1 lg:order-2 lg:col-span-2 lg:sticky lg:top-8">
            <div className="border-primary/30 bg-surface-high rounded-3xl border p-7 shadow-2xl">
              <span className="text-primary text-xs font-semibold tracking-wide uppercase">Mobile &amp; web apps</span>
              <p className="text-muted mt-3 text-sm leading-relaxed">
                Sign in as the person who manages {domain ? <b className="text-text">{domain}</b> : "your domain"} to
                refresh its app settings. Buying mobile access is done in the desktop app — not here.
              </p>

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
                ) : status === "checking" ? (
                  <p className="text-dim text-sm">Refreshing {domain}…</p>
                ) : status === "active" ? (
                  <div className="border-primary/30 bg-primary/[0.07] rounded-xl border p-4">
                    <div className="text-heading flex items-center gap-2 font-semibold">
                      <CheckCircleIcon size={18} />
                      {domain} is on
                    </div>
                    <p className="text-muted mt-1.5 text-sm leading-relaxed">
                      Mobile settings refreshed — everyone with a mailbox on {domain} can sign in on the app. No
                      charge; this just updated the app to point at your current backend.
                    </p>
                    <a
                      href="/account"
                      className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                    >
                      Manage your domains <ArrowRightIcon size={14} />
                    </a>
                  </div>
                ) : (
                  <div className="border-hairline bg-surface rounded-xl border p-4">
                    <div className="text-heading flex items-center gap-2 font-semibold">
                      <DevicesIcon size={18} /> Set it up in the app
                    </div>
                    <p className="text-muted mt-1.5 text-sm leading-relaxed">
                      Mobile access for {domain} isn&apos;t on yet. Set it up right inside the{" "}
                      <b className="text-text">MailPoppy desktop app</b> — open this domain and choose{" "}
                      <b className="text-text">Set up mobile access</b>. No separate signup here.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className="text-dim mt-3 flex items-center justify-center gap-1.5 text-center text-xs">
              <span className="text-primary">
                <ShieldIcon size={12} />
              </span>
              We never see your mail — this only refreshes the app settings.
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
