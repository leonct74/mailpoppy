// The directory: email-domain → deployment config. Backed by Firestore `domains/{domain}`,
// with an optional in-code SEED so resolution works before Firestore is enabled/seeded.
//
// The subscription gate (Phase B): a Firestore domain resolves only when its per-domain
// client access is activated AND the owning account's subscription is in good standing —
// otherwise { ok:false, reason:"inactive_subscription" }. The pure decision lives in
// entitlement.ts. The in-code SEED (our own launch deployment) is always entitled.
import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "./firestore";
import { isDomainEntitled } from "./entitlement";
import type { AccountRecord, DeploymentConfig, DomainRecord, ResolveResult } from "./types";

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

/** Read the owning account, normalising a Firestore Timestamp `currentPeriodEnd` to epoch ms. */
async function readAccount(db: Firestore, accountId: string | null): Promise<AccountRecord | null> {
  if (!accountId) return null;
  try {
    const snap = await db.collection("accounts").doc(accountId).get();
    if (!snap.exists) return null;
    const data = snap.data()! as AccountRecord;
    const cpe: unknown = data.currentPeriodEnd;
    const currentPeriodEnd =
      cpe == null
        ? null
        : typeof cpe === "number"
          ? cpe
          : typeof (cpe as { toMillis?: () => number }).toMillis === "function"
            ? (cpe as { toMillis: () => number }).toMillis()
            : null;
    return { ...data, currentPeriodEnd };
  } catch (e) {
    console.warn("[hub] account lookup failed:", e);
    return null;
  }
}

export async function resolveDomain(input: string): Promise<ResolveResult> {
  const domain = normaliseDomain(input);
  if (!DOMAIN_RE.test(domain)) return { ok: false, reason: "unknown_domain" };

  // Our own launch deployment is always entitled (it funds itself).
  if (SEED[domain]) return { ok: true, deployment: SEED[domain] };

  const db = getDb();
  if (!db) return { ok: false, reason: "unknown_domain" };

  try {
    const snap = await db.collection("domains").doc(domain).get();
    if (!snap.exists) return { ok: false, reason: "unknown_domain" };
    const rec = snap.data() as DomainRecord;
    if (!rec?.deployment?.apiBaseUrl) return { ok: false, reason: "unknown_domain" };

    // Admin comp bypasses the paywall (and needs no account lookup).
    if (rec.manualEntitlement === true) return { ok: true, deployment: rec.deployment };

    // The gate: the domain must be activated AND its account in good standing.
    const account = await readAccount(db, rec.accountId);
    if (!isDomainEntitled(rec, account, Date.now())) {
      return { ok: false, reason: "inactive_subscription" };
    }
    return { ok: true, deployment: rec.deployment };
  } catch (e) {
    console.warn("[hub] resolve lookup failed:", e);
    return { ok: false, reason: "unknown_domain" };
  }
}
