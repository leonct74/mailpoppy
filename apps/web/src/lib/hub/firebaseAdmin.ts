// Firebase Admin (server-side) for the Hub's account plane: verifying the admin's Firebase
// login token on account-authed routes. Runs on Application Default Credentials on App Hosting
// (same as firestore.ts) — no service-account key. Defensive: returns null if Auth is
// unavailable so an un-provisioned env never crashes.
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | null | undefined;

function getAdminApp(): App | null {
  if (app !== undefined) return app;
  try {
    app = getApps()[0] ?? initializeApp(); // ADC on App Hosting
  } catch (e) {
    console.warn("[hub] firebase-admin unavailable:", e);
    app = null;
  }
  return app;
}

export function getAdminAuth(): Auth | null {
  const a = getAdminApp();
  return a ? getAuth(a) : null;
}

/** The signed-in MailPoppy account (admin) behind a request, or null if unauthenticated. */
export interface AuthedUser {
  uid: string;
  email: string | null;
}

/** Verify the `Authorization: Bearer <Firebase ID token>` header. Returns null on any failure. */
export async function verifyRequest(req: Request): Promise<AuthedUser | null> {
  const auth = getAdminAuth();
  if (!auth) return null;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer (.+)$/i);
  if (!m) return null;
  try {
    const decoded = await auth.verifyIdToken(m[1]);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}
