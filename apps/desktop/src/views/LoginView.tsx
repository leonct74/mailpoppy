import { useState } from "react";
import type { Authenticator } from "../lib/auth";

// Mailbox sign-in (Cognito). On success the parent gets a getToken() it hands to
// the live MailClient. Admin-created users are prompted to set a password first.

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16, maxWidth: 420 };
const field: React.CSSProperties = { width: "100%", padding: 8, marginBottom: 10 };
const label: React.CSSProperties = { display: "block", fontSize: 13, color: "#555", marginBottom: 2 };

export function LoginView({
  auth,
  onSignedIn,
  onReconfigure,
}: {
  auth: Authenticator;
  onSignedIn: () => void;
  onReconfigure?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={box}>
      <h3 style={{ marginTop: 0 }}>Sign in to your mailbox</h3>

      {!needsNewPassword ? (
        <>
          <label style={label}>Email</label>
          <input aria-label="Email" style={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourdomain.com" autoComplete="username" />
          <label style={label}>Password</label>
          <input aria-label="Password" style={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </>
      ) : (
        <>
          <p style={{ color: "#666", fontSize: 13 }}>Set a new password to finish activating this mailbox.</p>
          <label style={label}>New password</label>
          <input aria-label="New password" style={field} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
        </>
      )}

      {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => void submit()} disabled={busy} style={{ cursor: "pointer", padding: "8px 14px" }}>
          {busy ? "…" : needsNewPassword ? "Set password & sign in" : "Sign in"}
        </button>
        {onReconfigure && (
          <button onClick={onReconfigure} style={{ cursor: "pointer", background: "none", border: "none", color: "#7c3aed", textDecoration: "underline" }}>
            Change deployment
          </button>
        )}
      </div>
    </div>
  );
}
