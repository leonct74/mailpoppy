// Lazy Firestore (Firebase Admin) accessor for the Hub. On Firebase App Hosting the
// app runs with Application Default Credentials, so initializeApp() needs no keys.
// Locally, set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON.
//
// Everything is defensive: if credentials/Firestore aren't available the getter
// returns null and callers fall back (so a build or an un-provisioned env never crashes).
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cached: Firestore | null | undefined;

export function getDb(): Firestore | null {
  if (cached !== undefined) return cached;
  try {
    const app: App = getApps()[0] ?? initializeApp(); // ADC on App Hosting
    cached = getFirestore(app);
  } catch (e) {
    console.warn("[hub] Firestore unavailable; using in-code seed only:", e);
    cached = null;
  }
  return cached;
}
