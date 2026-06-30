import { useEffect, useState, type FormEvent } from "react";
import { Smartphone } from "lucide-react";
import type { User } from "firebase/auth";
import { Card, Button, Input, ExtLink } from "../ui";
import { loadDeploymentConfig } from "../lib/deploymentConfig";
import {
  onHubAuth,
  hubSignIn,
  hubSignOut,
  registerDomain,
  deregisterDomain,
  HUB_ACCOUNT_URL,
} from "../lib/hubAccount";

// Per-domain "make it available in the mobile + web apps" panel. The admin signs into their
// MailPoppy account (the same one as mailpoppy.com), and registering publishes this domain's
// PUBLIC backend config to the Hub so it appears on the /account dashboard, ready to activate.
// This is the desktop end of Phase C — it removes any need to hand-edit the directory.
export function MobileAppAccess({ domain }: { domain: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => onHubAuth((u) => {
    setUser(u);
    setReady(true);
  }), []);

  const config = loadDeploymentConfig();

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await hubSignIn(email, password);
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister() {
    if (!config) {
      setError("Set up this domain's backend first, then make it available here.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerDomain(domain, {
        region: config.region,
        userPoolId: config.userPoolId,
        clientId: config.clientId,
        apiBaseUrl: config.apiBaseUrl,
      });
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make this domain available.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    try {
      await deregisterDomain(domain);
      setRegistered(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this domain.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-primary" />
        <h3 className="font-semibold text-on-surface">Mobile &amp; web apps</h3>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
        Make <b className="text-on-surface">{domain}</b> available in the MailPoppy phone and web apps, so the
        people with mailboxes here can sign in from anywhere.
      </p>

      {!user ? (
        <form onSubmit={onSignIn} className="mt-4 max-w-sm space-y-2">
          <p className="text-sm text-on-surface-variant">
            Sign in with your MailPoppy account — the same one you use at{" "}
            <ExtLink href={HUB_ACCOUNT_URL} className="text-primary hover:underline">
              mailpoppy.com/account
            </ExtLink>
            .
          </p>
          <Input
            type="email"
            required
            placeholder="you@yourdomain.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            required
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : registered ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-on-surface">
            ✓ <b>{domain}</b> is available in the apps. Turn the mobile app on for it (and manage billing) at{" "}
            <ExtLink href={HUB_ACCOUNT_URL} className="text-primary hover:underline">
              mailpoppy.com/account
            </ExtLink>
            .
          </p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onRemove}>
              {busy ? "Removing…" : "Remove from apps"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void hubSignOut()}>
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-on-surface-variant">
            Signed in as <b className="text-on-surface">{user.email}</b>.
          </p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={onRegister}>
              {busy ? "Making available…" : `Make ${domain} available`}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void hubSignOut()}>
              Sign out
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email or password doesn't match.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a minute and try again.";
    default:
      return (e as { message?: string })?.message ?? "Couldn't sign you in.";
  }
}
