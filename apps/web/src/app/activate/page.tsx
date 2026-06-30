"use client";

// The activation funnel the desktop app links to ("See the pricing"). It carries a domain + its
// PUBLIC backend config in the URL. Here the admin sees the price, what the service is, and the
// terms; signs in or signs up; and subscribes. On sign-in we register the domain with the Hub so
// it's bound + resolvable; on checkout success we confirm it's live and point at the apps.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/hub/firebaseClient";

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
        <div className="border-hairline bg-surface rounded-2xl border p-6 text-center">
          <div className="text-3xl">🎉</div>
          <h1 className="text-heading mt-2 text-2xl font-bold">You&apos;re all set</h1>
          <p className="text-text mt-3">
            You can now use the <b>MailPoppy mobile app</b> with any mailbox created under{" "}
            <b className="text-heading">{activated}</b>
            {others.length > 0 && (
              <>
                {" "}
                or <b className="text-heading">{others.join(", ")}</b>
              </>
            )}
            .
          </p>
          <div className="border-hairline bg-bg-elevated mt-6 rounded-xl border p-4">
            <div className="text-text font-semibold">Get the app</div>
            <p className="text-dim mt-1 text-sm">
              Sign in with your mailbox email and password. The MailPoppy mobile app is{" "}
              <b className="text-text">coming soon</b> to the App Store and Google Play.
            </p>
          </div>
          <a href="/account" className="text-primary mt-6 inline-block text-sm hover:underline">
            Manage your domains →
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-heading text-2xl font-bold">Activate the MailPoppy mobile app</h1>
      {domain ? (
        <p className="text-dim mt-1">
          For <b className="text-text">{domain}</b> — so everyone with a mailbox here can use the app from anywhere.
        </p>
      ) : (
        <p className="text-dim mt-1">Open this page from the MailPoppy desktop app to activate a domain.</p>
      )}

      {/* Price + what it is + terms */}
      <div className="border-hairline bg-surface mt-6 rounded-2xl border p-5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-text font-semibold">MailPoppy mobile &amp; web apps</div>
          <div className="text-heading text-xl font-bold">{priceLabel ?? "—"}</div>
        </div>
        <div className="text-dim mt-1 text-sm">per domain{price?.interval ? "" : ""}</div>
        <ul className="text-on-surface-variant mt-4 space-y-1.5 text-sm">
          <li>• Everyone with a mailbox on this domain can sign in to the mobile &amp; web apps.</li>
          <li>• Your mail keeps running in your own AWS account — we never see it.</li>
          <li>• Billed per domain. Cancel anytime; access stays until the period ends.</li>
          <li>• This is separate from your email — it just unlocks the apps for this domain.</li>
        </ul>
      </div>

      {error && <p className="text-danger mt-4 text-sm">{error}</p>}

      {/* Auth + subscribe */}
      {!authReady ? (
        <p className="text-dim mt-6">Loading…</p>
      ) : !auth ? (
        <p className="text-dim mt-6 text-sm">Sign-in isn&apos;t configured. Set the NEXT_PUBLIC_FIREBASE_* values.</p>
      ) : !user ? (
        <form onSubmit={submitLogin} className="border-hairline bg-surface mt-6 max-w-sm space-y-3 rounded-2xl border p-5">
          <p className="text-text font-semibold">
            {mode === "signup" ? "Create your MailPoppy account" : "Sign in to continue"}
          </p>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-surface-high border-hairline w-full rounded-lg border px-3 py-2 outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={mode === "signup" ? "Choose a password (6+ characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-surface-high border-hairline w-full rounded-lg border px-3 py-2 outline-none focus:border-primary"
          />
          {formErr && <p className="text-danger text-sm">{formErr}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-text w-full rounded-lg py-2 font-semibold disabled:opacity-60"
          >
            {submitting ? "…" : mode === "signup" ? "Create account & continue" : "Sign in & continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setFormErr(null);
            }}
            className="text-dim hover:text-text w-full text-sm"
          >
            {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </form>
      ) : (
        <div className="mt-6">
          <button
            onClick={() => void subscribe()}
            disabled={busy || !domain}
            className="bg-primary text-primary-text rounded-lg px-5 py-2.5 font-semibold disabled:opacity-60"
          >
            {busy ? "Starting checkout…" : priceLabel ? `Subscribe — ${priceLabel}` : "Subscribe"}
          </button>
          <p className="text-dim mt-2 text-xs">Signed in as {user.email}. Secure checkout via Stripe.</p>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl px-5 py-12">{children}</main>;
}
