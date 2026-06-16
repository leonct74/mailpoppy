// The directory: email-domain → deployment config. Backed by Firestore `domains/{domain}`,
// with an optional in-code SEED so resolution works before Firestore is enabled/seeded.
//
// Phase A: the subscription gate is stubbed — any seeded/registered domain resolves.
// Phase B will read the owning account's subscriptionStatus and return
// { ok:false, reason:"inactive_subscription" } when it isn't active.
import { getDb } from "./firestore";
import type { DeploymentConfig, DomainRecord, ResolveResult } from "./types";

// Zero-infra quickstart: add your launch domain(s) here to resolve without Firestore.
// These are PUBLIC client identifiers (same values the clients used to hard-code).
const SEED: Record<string, DeploymentConfig> = {
  // Launch domain — the first backend, served without Firestore. Same PUBLIC
  // identifiers the clients used to hard-code, so this can't break the fallback path.
  "mailpoppy.com": {
    region: "eu-west-1",
    userPoolId: "eu-west-1_yV09AF6Ja",
    clientId: "361bkf3ja4ukgmqtgf17mbc37",
    apiBaseUrl: "https://017dtrbes1.execute-api.eu-west-1.amazonaws.com",
  },
};

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function normaliseDomain(input: string): string {
  return input.trim().toLowerCase();
}

export async function resolveDomain(input: string): Promise<ResolveResult> {
  const domain = normaliseDomain(input);
  if (!DOMAIN_RE.test(domain)) return { ok: false, reason: "unknown_domain" };

  if (SEED[domain]) return { ok: true, deployment: SEED[domain] };

  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection("domains").doc(domain).get();
      if (snap.exists) {
        const rec = snap.data() as DomainRecord;
        if (rec?.deployment?.apiBaseUrl) {
          return { ok: true, deployment: rec.deployment };
        }
      }
    } catch (e) {
      console.warn("[hub] resolve lookup failed:", e);
    }
  }
  return { ok: false, reason: "unknown_domain" };
}
