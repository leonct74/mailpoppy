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
import { fetchAgentsPoppyDomainEntitled } from "./agentspoppy";
import type { AccountRecord, DeploymentConfig, DomainRecord, ResolveResult } from "./types";

// OPTIONAL in-code fallback so a domain can resolve before Firestore is seeded. Deliberately EMPTY:
// mailpoppy.com used to be hard-seeded here, but a hard-coded deployment is a trap — resolveDomain
// returns the seed BEFORE reading Firestore, so a real registration can never override it, and the
// pinned backend goes stale/dead the moment that stack is redeployed or torn down (exactly what
// happened: it pinned a Cognito pool + API that no longer exist, leaving mailpoppy.com permanently
// "stale" with no way to fix it from the app). Every domain — mailpoppy.com included — now resolves
// from its Firestore registration + the entitlement gate. Only re-add an entry for a PERMANENT backend
// you will never rebuild.
const SEED: Record<string, DeploymentConfig> = {};

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

    // The gate: entitled via AgentsPoppy's cached mirror, or (legacy) activated + account in good
    // standing. The mirror keeps this a pure Firestore read on the happy path.
    const account = await readAccount(db, rec.accountId);
    if (isDomainEntitled(rec, account, Date.now())) {
      return { ok: true, deployment: rec.deployment };
    }

    // Not entitled by anything we've stored — do ONE live check against AgentsPoppy (the source of
    // truth) to self-heal a purchase whose webhook we never received. Only on the negative path, so
    // it can't slow down or couple the common case. If it says yes, persist the mirror and allow.
    const live = await fetchAgentsPoppyDomainEntitled(domain);
    if (live === true) {
      await db
        .collection("domains")
        .doc(domain)
        .set({ agentspoppyEntitled: true }, { merge: true })
        .catch((e) => console.warn("[hub] failed to persist agentspoppyEntitled mirror:", e));
      return { ok: true, deployment: rec.deployment };
    }

    return { ok: false, reason: "inactive_subscription" };
  } catch (e) {
    console.warn("[hub] resolve lookup failed:", e);
    return { ok: false, reason: "unknown_domain" };
  }
}
