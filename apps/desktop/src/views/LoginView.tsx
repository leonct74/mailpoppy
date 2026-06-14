import { useEffect, useState } from "react";
import type { Authenticator } from "../lib/auth";
import { Card, Button, Spinner } from "../ui";
import { friendlyError } from "../lib/errors";

// Mailbox sign-in (Cognito). On success the parent gets a getToken() it hands to
// the live MailClient. Admin-created users are prompted to set a password first.

const fieldCls =
  "w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-sm text-on-surface-variant";

export function LoginView({
  auth,
  onSignedIn,
  onReconfigure,
  prefillEmail,
}: {
  auth: Authenticator;
  onSignedIn: () => void;
  onReconfigure?: () => void;
  prefillEmail?: string;
}) {
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  // When the user deep-links here from a specific mailbox (e.g. "Open inbox" in
  // the domain workspace), pre-fill the email so they only type a password.
  useEffect(() => {
    if (prefillEmail) setEmail(prefillEmail);
  }, [prefillEmail]);
  const [newPassword, setNewPassword] = useState("");
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = needsNewPassword
        ? await auth.completeNewPassword(newPassword)
        : await auth.signIn(email.trim(), password);
      if (res.status === "new-password-required") {
        setNeedsNewPassword(true);
      } else {
        onSignedIn();
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-md">
      <h3 className="text-lg font-semibold text-on-surface">Sign in to your mailbox</h3>

      <div className="mt-4 flex flex-col gap-3">
        {!needsNewPassword ? (
          <>
            <div>
              <label className={labelCls}>Email</label>
              <input aria-label="Email" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourdomain.com" autoComplete="username" />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input aria-label="Password" className={fieldCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-on-surface-variant">Set a new password to finish activating this mailbox.</p>
            <div>
              <label className={labelCls}>New password</label>
              <input aria-label="New password" className={fieldCls} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </>
        )}
      </div>

      {err && <p className="mt-2 text-sm text-tertiary">{err}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner className="border-white/40 border-t-white" />}
          {busy ? "…" : needsNewPassword ? "Set password & sign in" : "Sign in"}
        </Button>
        {onReconfigure && (
          <button onClick={onReconfigure} className="text-sm text-primary underline-offset-2 hover:underline">
            Change deployment
          </button>
        )}
      </div>
    </Card>
  );
}
