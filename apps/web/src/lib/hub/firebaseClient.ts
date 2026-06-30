// Client-side Firebase (browser) for the admin dashboard's login. Reads the public
// NEXT_PUBLIC_FIREBASE_* config (inlined at build). The apiKey here is a public client
// identifier, not a secret. Returns null if the config isn't present so the page can show a
// clear "not configured" state instead of throwing.
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let cachedApp: FirebaseApp | null | undefined;

function getClientApp(): FirebaseApp | null {
  if (cachedApp !== undefined) return cachedApp;
  if (typeof window === "undefined") return null; // never initialise Firebase during SSR/prerender
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId) {
    cachedApp = null;
    return null;
  }
  cachedApp = getApps().length ? getApp() : initializeApp({ apiKey, authDomain, projectId, appId });
  return cachedApp;
}

export function getClientAuth(): Auth | null {
  const app = getClientApp();
  return app ? getAuth(app) : null;
}

/** Convenience: the current user's fresh ID token for Authorization headers, or null. */
export async function currentIdToken(): Promise<string | null> {
  const auth = getClientAuth();
  const user = auth?.currentUser;
  return user ? user.getIdToken() : null;
}
