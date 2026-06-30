// The MailPoppy account (Hub) connection from the desktop app. Lets the admin sign into the same
// MailPoppy account they use on mailpoppy.com, and register a domain's backend with the Hub so it
// shows up on the /account dashboard and can be activated for the mobile + web apps.
//
// The Firebase web config is fetched from the Hub (/api/firebase-config) at runtime rather than
// baked into the build — those values are public, and fetching them keeps the desktop in lockstep
// with whatever project the website uses. All values handled here are public; no secrets.
import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseApp,
} from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";

// Where the Hub lives. Override for staging by setting localStorage["mailpoppy.hubUrl"].
const HUB_URL = (
  (typeof localStorage !== "undefined" && localStorage.getItem("mailpoppy.hubUrl")) ||
  "https://mailpoppy.com"
).replace(/\/$/, "");

let authPromise: Promise<Auth | null> | null = null;

/** Lazily fetch the public Firebase config + init Auth. Returns null if the Hub is unreachable. */
async function ensureAuth(): Promise<Auth | null> {
  if (authPromise) return authPromise;
  authPromise = (async () => {
    try {
      const res = await fetch(`${HUB_URL}/api/firebase-config`);
      if (!res.ok) return null;
      const cfg = (await res.json()) as {
        apiKey?: string;
        authDomain?: string;
        projectId?: string;
        appId?: string;
      };
      if (!cfg.apiKey || !cfg.projectId) return null;
      const app: FirebaseApp = getApps().length
        ? getApp()
        : initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            appId: cfg.appId,
          });
      return getAuth(app);
    } catch {
      return null;
    }
  })();
  return authPromise;
}

/** Subscribe to sign-in state. Fires with the current user (or null) and on every change. */
export function onHubAuth(cb: (user: User | null) => void): () => void {
  let unsub = () => {};
  void ensureAuth().then((auth) => {
    if (auth) unsub = onAuthStateChanged(auth, cb);
    else cb(null);
  });
  return () => unsub();
}

export async function hubSignIn(email: string, password: string): Promise<void> {
  const auth = await ensureAuth();
  if (!auth) throw new Error("Couldn't reach the MailPoppy account service. Check your connection.");
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function hubSignUp(email: string, password: string): Promise<void> {
  const auth = await ensureAuth();
  if (!auth) throw new Error("Couldn't reach the MailPoppy account service. Check your connection.");
  await createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function hubSignOut(): Promise<void> {
  const auth = await ensureAuth();
  if (auth) await fbSignOut(auth);
}

async function idToken(): Promise<string> {
  const auth = await ensureAuth();
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to your MailPoppy account first.");
  return user.getIdToken();
}

export interface DeploymentForHub {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

/** Register a domain + its backend with the Hub, bound to the signed-in account. */
export async function registerDomain(domain: string, deployment: DeploymentForHub): Promise<void> {
  const token = await idToken();
  const res = await fetch(`${HUB_URL}/api/deployments/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ domain, ...deployment }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(hubError(j.error) || `Couldn't register this domain (${res.status}).`);
  }
}

/** Remove a domain's Hub mapping (so it leaves the dashboard + the directory). */
export async function deregisterDomain(domain: string): Promise<void> {
  const token = await idToken();
  const res = await fetch(`${HUB_URL}/api/deployments/${encodeURIComponent(domain)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(hubError(j.error) || `Couldn't remove this domain (${res.status}).`);
  }
}

/** The mailpoppy.com/account page, where the admin activates mobile for a registered domain. */
export const HUB_ACCOUNT_URL = `${HUB_URL}/account`;

function hubError(code?: string): string {
  switch (code) {
    case "owned_by_another_account":
      return "This domain is already linked to a different MailPoppy account.";
    case "incomplete_deployment":
      return "This domain's backend isn't fully deployed yet.";
    case "invalid_domain":
      return "That doesn't look like a valid domain.";
    default:
      return "";
  }
}
