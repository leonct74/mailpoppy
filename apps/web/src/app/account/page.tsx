"use client";

// The admin billing dashboard. Sign in with a MailPoppy account (Firebase email/password),
// see the domains you own, and turn the mobile client on/off per domain. Activation goes
// through Stripe (Checkout for your first domain, then add-on for the rest); "Manage billing"
// opens the Stripe portal. All data comes from /api/account; actions hit the account routes.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/hub/firebaseClient";

interface DomainRow {
  domain: string;
  mobileActive: boolean;
  verified: boolean;
}
interface AccountData {
  email: string;
  subscriptionStatus: string;
  currentPeriodEnd: number | null;
  domains: DomainRow[];
}

function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
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

export default function AccountPage() {
  const auth = getClientAuth();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (user) void load();
    else setData(null);
  }, [user, load]);

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

  // `authReady` is false on the server and on the client's first paint, so both render the same
  // "Loading…" shell — no hydration mismatch. It flips true once onAuthStateChanged fires (or
  // immediately if Firebase isn't configured).
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
        <p className="text-dim">
          Sign-in isn&apos;t configured yet. Set the <code>NEXT_PUBLIC_FIREBASE_*</code> values and rebuild.
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <h1 className="text-heading text-2xl font-bold">Your MailPoppy account</h1>
        <p className="text-dim mt-1">Sign in to turn the mobile app on for your domains.</p>
        <form onSubmit={submitLogin} className="border-hairline bg-surface mt-6 space-y-3 rounded-2xl border p-5">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@yourdomain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-surface-high border-hairline w-full rounded-lg border px-3 py-2 outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="Password"
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
            {submitting ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setFormErr(null);
            }}
            className="text-dim hover:text-text w-full text-sm"
          >
            {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </form>
      </Shell>
    );
  }

  const status = data?.subscriptionStatus ?? "none";
  return (
    <Shell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading text-2xl font-bold">Mobile access</h1>
          <p className="text-dim mt-1 text-sm">{user.email}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {status !== "none" && (
            <button
              onClick={() => act("/api/account/portal")}
              disabled={busy === "portal"}
              className="border-hairline text-text hover:bg-surface-variant rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {busy === "portal" ? "…" : "Manage billing"}
            </button>
          )}
          <button
            onClick={() => signOut(auth)}
            className="text-dim hover:text-text rounded-lg px-3 py-1.5 text-sm"
          >
            Sign out
          </button>
        </div>
      </div>

      {justActivated && (
        <p className="border-hairline bg-surface text-text mt-4 rounded-xl border p-3 text-sm">
          ✓ Payment received — turning on <b>{justActivated}</b>. If it&apos;s not on below yet, give it a few
          seconds and refresh.
        </p>
      )}
      {error && <p className="text-danger mt-4 text-sm">{error}</p>}

      <div className="mt-6 space-y-2">
        {loading && !data && <p className="text-dim">Loading…</p>}
        {data && data.domains.length === 0 && (
          <p className="text-dim border-hairline bg-surface rounded-2xl border p-5">
            No domains yet. Set up a domain in the MailPoppy desktop app first, then come back here to turn on
            the mobile client for it.
          </p>
        )}
        {data?.domains.map((d) => (
          <div
            key={d.domain}
            className="border-hairline bg-surface flex items-center justify-between gap-4 rounded-xl border p-4"
          >
            <div>
              <div className="text-text font-semibold">{d.domain}</div>
              <div className="text-dim text-xs">
                {d.mobileActive ? "Mobile client on for everyone in this domain" : "Mobile client off"}
              </div>
            </div>
            {d.mobileActive ? (
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-primary/15 text-primary px-2.5 py-1 text-xs font-semibold">
                  Active
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
              <button
                onClick={() => act("/api/account/checkout", d.domain)}
                disabled={busy === d.domain}
                className="bg-primary text-primary-text rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
              >
                {busy === d.domain ? "…" : "Activate mobile"}
              </button>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl px-5 py-12">{children}</main>;
}
