import { useEffect, useState } from "react";
import { KeyRound, Copy, Check, ShieldAlert } from "lucide-react";
import type { Authenticator } from "../lib/auth";
import { Card, Button, Spinner } from "../ui";
import { friendlyError } from "../lib/errors";

// Mailbox sign-in (Cognito). On success the parent gets a getToken() it hands to
// the live MailClient. Admin-created users are prompted to set a password first.

/** What `onEstablishKeys` reports back so the view can show the recovery key once
 *  (first keygen) or warn that a password reset re-keyed the mailbox. Structurally
 *  matches EstablishOutcome in ../lib/mailboxKeys, kept local so this view (and its
 *  test) need not pull in libsodium. */
export interface EstablishKeysOutcome {
  created: boolean;
  rekeyed: boolean;
  recoveryKey?: string;
}

const fieldCls =
  "w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "mb-1 block text-sm text-on-surface-variant";

export function LoginView({
  auth,
  onSignedIn,
  onReconfigure,
  prefillEmail,
  onEstablishKeys,
}: {
  auth: Authenticator;
  onSignedIn: () => void;
  onReconfigure?: () => void;
  prefillEmail?: string;
  /** Establish the mailbox encryption keypair for the just-authenticated session,
   *  using the password the user just typed. Optional: when omitted (e.g. tests,
   *  demo, or a deployment without the keys endpoint) sign-in proceeds unchanged. */
  onEstablishKeys?: (password: string) => Promise<EstablishKeysOutcome>;
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
  // Set once the mailbox keypair is freshly created: show the recovery key once
  // before entering the inbox. `rekeyed` means it followed an admin password reset.
  const [recovery, setRecovery] = useState<{ key: string; rekeyed: boolean } | null>(null);

  // Run key establishment (non-fatal) then either show the recovery key or finish.
  async function establishThenFinish(pw: string) {
    if (!onEstablishKeys) {
      onSignedIn();
      return;
    }
    try {
      const r = await onEstablishKeys(pw);
      if (r.created && r.recoveryKey) {
        setRecovery({ key: r.recoveryKey, rekeyed: r.rekeyed });
        return; // RecoveryKeyPanel takes over until acknowledged
      }
    } catch {
      // Encryption isn't enforced during rollout — never block sign-in on it.
    }
    onSignedIn();
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const pw = needsNewPassword ? newPassword : password;
      const res = needsNewPassword ? await auth.completeNewPassword(newPassword) : await auth.signIn(email.trim(), password);
      if (res.status === "new-password-required") {
        setNeedsNewPassword(true);
      } else {
        await establishThenFinish(pw);
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    return <RecoveryKeyPanel recoveryKey={recovery.key} rekeyed={recovery.rekeyed} onContinue={onSignedIn} />;
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

/**
 * Shown once, right after a mailbox keypair is created (first login, or a re-key
 * after an admin password reset). The recovery key is the user's ONLY way back
 * into their encrypted mail if they forget their password — no one, including the
 * admin, can recover it for them. So we gate "Continue" on an explicit "I've saved
 * it" acknowledgement.
 */
function RecoveryKeyPanel({ recoveryKey, rekeyed, onContinue }: { recoveryKey: string; rekeyed: boolean; onContinue: () => void }) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the user can still select the text manually */
    }
  }

  return (
    <Card className="max-w-md">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" />
        <h3 className="text-lg font-semibold text-on-surface">Save your recovery key</h3>
      </div>

      {rekeyed && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-tertiary/30 bg-tertiary/10 p-3 text-sm text-on-surface-variant">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-tertiary" />
          <span>Your password was reset, so a new encryption key was created. Mail received before the reset can no longer be opened — this is by design.</span>
        </div>
      )}

      <p className="mt-3 text-sm text-on-surface-variant">
        Your mailbox is encrypted with your password — not even the admin can read it. If you ever forget your
        password, this recovery key is the <strong>only</strong> way to get your mail back. Store it somewhere safe
        (a password manager is ideal). It is shown only once.
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3">
        <code aria-label="Recovery key" className="min-w-0 flex-1 break-all font-mono text-xs text-on-surface">
          {recoveryKey}
        </code>
        <button
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-outline-variant/30 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high"
        >
          {copied ? <Check className="size-3.5 text-secondary" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-on-surface-variant">
        <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        <span>I’ve saved my recovery key somewhere safe.</span>
      </label>

      <div className="mt-4">
        <Button onClick={onContinue} disabled={!acknowledged}>
          Continue to mailbox
        </Button>
      </div>
    </Card>
  );
}
