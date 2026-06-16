"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  signIn,
  completeNewPassword,
  requestPasswordReset,
  confirmPasswordReset,
} from "@/lib/auth";
import { resolveConfig } from "@/lib/config";
import { PRIVACY_VERSION } from "@/lib/legal";
import { Logo } from "./Logo";
import {
  MailIcon,
  LockIcon,
  KeyIcon,
  ArrowRightIcon,
  CloudIcon,
} from "./icons";

type Mode = "signin" | "newpw" | "forgot" | "reset";

// Remember Privacy Policy acceptance across sessions (per policy version, so a
// material change re-prompts). Guarded for SSR / privacy-mode storage failures.
const ACCEPT_KEY = "mp_privacy_accepted_version";
function readAccepted(): boolean {
  try {
    return Number(localStorage.getItem(ACCEPT_KEY)) >= PRIVACY_VERSION;
  } catch {
    return false;
  }
}
function persistAccepted(): void {
  try {
    localStorage.setItem(ACCEPT_KEY, String(PRIVACY_VERSION));
  } catch {
    /* non-fatal — they'll be asked again next visit */
  }
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Privacy Policy: must be accepted before the first sign-in (remembered after).
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setAccepted(readAccepted());
  }, []);

  function toggleAccepted() {
    setAccepted((prev) => {
      const next = !prev;
      if (next) persistAccepted();
      return next;
    });
  }

  function go(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signin" && !accepted) return; // gate: must accept first
    setBusy(true);
    setError(null);
    try {
      if (mode === "newpw") {
        await completeNewPassword(newPassword);
        onSignedIn();
      } else if (mode === "forgot") {
        const addr = email.trim().toLowerCase();
        await resolveConfig(addr); // point at the right backend before emailing a code
        await requestPasswordReset(addr);
        setResetCode("");
        setNewPassword("");
        setNotice(`We emailed a reset code to ${addr}.`);
        go("reset");
      } else if (mode === "reset") {
        await confirmPasswordReset(email.trim().toLowerCase(), resetCode, newPassword);
        setPassword("");
        setNewPassword("");
        setResetCode("");
        setNotice("Password changed. Sign in with your new password.");
        go("signin");
      } else {
        const addr = email.trim().toLowerCase();
        await resolveConfig(addr); // resolve this domain's backend, then sign in against it
        const res = await signIn(addr, password);
        if (res.status === "new-password-required") go("newpw");
        else onSignedIn();
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const resetting = mode === "forgot" || mode === "reset";
  const heading = resetting ? "Reset your password" : "Welcome back";
  const subtitle = resetting ? "We'll get you back in" : "Sign in to manage your inbox";
  const buttonLabel = busy
    ? "Please wait…"
    : mode === "newpw"
      ? "Set password & sign in"
      : mode === "forgot"
        ? "Send reset code"
        : mode === "reset"
          ? "Reset password"
          : "Sign in";

  return (
    <div className="bg-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Ambient crimson glow */}
      <div
        aria-hidden
        className="bg-primary-bright pointer-events-none absolute -top-28 -left-20 h-96 w-96 rounded-full opacity-[0.08] blur-2xl"
      />

      <form onSubmit={onSubmit} className="relative w-full max-w-sm">
        <div className="flex flex-col items-center">
          <Logo size="lg" className="mb-6" />
          <h1 className="text-heading text-2xl font-bold">{heading}</h1>
          <p className="text-muted mt-1.5 mb-6 text-sm">{subtitle}</p>
        </div>

        {notice && (mode === "signin" || mode === "reset") && (
          <p className="bg-surface-container border-hairline text-text mb-4 rounded-xl border px-4 py-3 text-sm">
            {notice}
          </p>
        )}

        <div className="bg-surface-container border-hairline rounded-2xl border p-6">
          {mode === "signin" && (
            <>
              <Field
                label="Email address"
                icon={MailIcon}
                type="email"
                placeholder="you@yourdomain.com"
                autoComplete="username"
                autoCapitalize="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
              <Field
                label="Password"
                icon={LockIcon}
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <label className="text-muted mb-1 flex cursor-pointer items-start gap-2.5 px-0.5 text-[13px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={toggleAccepted}
                  disabled={busy}
                  className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                />
                <span>
                  I have read and agree to the{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-heading font-semibold hover:underline"
                  >
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            </>
          )}

          {mode === "newpw" && (
            <>
              <p className="text-muted mb-4 text-sm leading-relaxed">
                This mailbox needs a new password to finish setup. Choose one now.
              </p>
              <Field
                label="New password"
                icon={LockIcon}
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
              />
            </>
          )}

          {mode === "forgot" && (
            <>
              <p className="text-muted mb-4 text-sm leading-relaxed">
                Enter your mailbox address and we&apos;ll email you a code to reset your password.
              </p>
              <Field
                label="Email address"
                icon={MailIcon}
                type="email"
                placeholder="you@yourdomain.com"
                autoComplete="username"
                autoCapitalize="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </>
          )}

          {mode === "reset" && (
            <>
              <Field
                label="Reset code"
                icon={KeyIcon}
                type="text"
                inputMode="numeric"
                placeholder="123456"
                autoComplete="one-time-code"
                autoCapitalize="off"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                disabled={busy}
              />
              <Field
                label="New password"
                icon={LockIcon}
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
              />
            </>
          )}

          <button
            type="submit"
            disabled={busy || (mode === "signin" && !accepted)}
            className="bg-primary text-primary-text mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {buttonLabel}
            {!busy && mode === "signin" && <ArrowRightIcon size={18} />}
          </button>

          {mode === "signin" && (
            <div className="mt-4 text-center">
              <LinkButton label="Forgot your password?" onClick={() => go("forgot")} disabled={busy} />
            </div>
          )}
          {mode === "forgot" && (
            <div className="mt-4 text-center">
              <LinkButton label="Back to sign in" onClick={() => go("signin")} disabled={busy} />
            </div>
          )}
          {mode === "reset" && (
            <div className="mt-4 text-center">
              <LinkButton label="Resend code" onClick={() => go("forgot")} disabled={busy} />
            </div>
          )}

          {error && <p className="text-danger mt-4 text-center text-sm leading-relaxed">{error}</p>}
        </div>

        <div className="text-muted mt-7 flex items-center justify-center gap-1.5 text-xs font-medium">
          <CloudIcon size={14} />
          Powered by AWS
          <span aria-hidden>·</span>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-heading font-semibold hover:underline">
            Privacy Policy
          </a>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  ...input
}: { label: string; icon: ComponentType<{ size?: number }> } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label className="text-muted mb-1.5 ml-0.5 block text-[11px] font-semibold tracking-wider uppercase">
        {label}
      </label>
      <div className="bg-surface-high focus-within:ring-primary/40 flex h-[52px] items-center rounded-xl px-3.5 transition-shadow focus-within:ring-2">
        <span className="text-muted mr-2.5">
          <Icon size={20} />
        </span>
        <input
          {...input}
          autoCorrect="off"
          className="text-text placeholder:text-dim h-full w-full bg-transparent text-base outline-none"
        />
      </div>
    </div>
  );
}

function LinkButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-heading text-[13px] font-semibold hover:underline disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/UserNotFound|NotAuthorized|Incorrect username or password/i.test(msg))
    return "That email or password isn't right. Please try again.";
  if (/Password does not conform|InvalidPassword/i.test(msg))
    return "That password doesn't meet the requirements (min 8 chars, upper & lower case, a number and a symbol).";
  if (/CodeMismatch/i.test(msg)) return "That reset code isn't right. Check the email and try again.";
  if (/ExpiredCode/i.test(msg)) return "That reset code has expired. Request a new one.";
  if (/LimitExceeded|TooManyRequests/i.test(msg))
    return "Too many attempts. Please wait a few minutes and try again.";
  if (/Network|fetch|Failed to fetch/i.test(msg))
    return "Couldn't reach the server. Check your connection and try again.";
  return msg;
}
