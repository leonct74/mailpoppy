// POST /api/account/reconcile — pull the account's true state from Stripe on demand and write it
// into Firestore, so a completed payment shows up even when the Stripe webhook is slow,
// unregistered, or failed. This is the on-demand twin of the webhook (stripeReconcile), callable
// by the signed-in owner. Authed with a Firebase ID token.
//
// SAFETY (this endpoint decides who has PAID access, so it is deliberately conservative):
//   • Subscription selection: the account's recorded sub, else the customer's newest GOOD-standing
//     sub. It never falls back to an arbitrary (possibly canceled) subscription, and only persists
//     a sub id when it is good-standing — so a stale/churned sub can't clobber the account.
//   • Binding a domain to a line item is done ONLY when it is UNAMBIGUOUS: exactly one line item
//     lacks metadata.domain AND exactly one owned domain is still unbound. That covers the common
//     first-domain case (one item, one domain) while making it impossible to fund the wrong domain
//     off another's paid seat when several domains are in play. The request body's `domain` is
//     advisory only — never trusted to pick which item funds which domain.
//   • A domain counts as funded (mobileActive) when a live line item carries its name OR its own
//     recorded stripeSubscriptionItemId is still present on the subscription — so a domain that was
//     paid for is never switched off just because an item's metadata went missing. Funding is gated
//     on the subscription being in good standing (active/trialing/past_due), matching the resolve gate.
// It only ever reads/writes the caller's own account and owned domains, so it can't touch anyone else.
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { getStripe } from "@/lib/hub/stripeClient";
import { reconcileSubscription, type StripeSubscriptionLike } from "@/lib/hub/stripeReconcile";
import type { AccountRecord, DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Statuses that mean the subscription is currently funding the account (past_due = payment retry
// grace, honoured by the resolve gate too — see entitlement.ts).
const GOOD = new Set(["active", "trialing", "past_due"]);

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The dashboard's data shape (identical to GET /api/account) so the client can render the reply. */
async function accountView(db: Firestore, uid: string, fallbackEmail: string | null) {
  const acct = (await db.collection("accounts").doc(uid).get()).data() as AccountRecord | undefined;
  const owned = await db.collection("domains").where("accountId", "==", uid).get();
  const domains = owned.docs.map((d) => {
    const r = d.data() as DomainRecord;
    return { domain: d.id, mobileActive: !!r.mobileActive, verified: !!r.verified };
  });
  return {
    email: acct?.email || fallbackEmail || "",
    subscriptionStatus: acct?.subscriptionStatus ?? "none",
    currentPeriodEnd: acct?.currentPeriodEnd ?? null,
    cancelAt: acct?.cancelAt ?? null,
    domains,
  };
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const stripe = getStripe();
  // No Stripe configured → nothing to pull; return whatever Firestore already holds. Never an error.
  if (!stripe) return NextResponse.json(await accountView(db, user.uid, user.email));

  try {
    const now = Date.now();
    const acctRef = db.collection("accounts").doc(user.uid);
    const acct = (await acctRef.get()).data() as AccountRecord | undefined;

    // 1) Select the subscription. Prefer the recorded one (reflects its real status, even if now
    //    canceled). Else the customer's newest GOOD-standing sub. NEVER an arbitrary canceled sub.
    let subId = acct?.stripeSubscriptionId ?? null;
    let sub: Stripe.Subscription | null = subId
      ? await stripe.subscriptions.retrieve(subId).catch(() => null)
      : null;
    if (!sub && acct?.stripeCustomerId) {
      const list = await stripe.subscriptions.list({ customer: acct.stripeCustomerId, status: "all", limit: 100 });
      sub = list.data.find((s) => GOOD.has(s.status)) ?? null; // no data[0] fallback — don't grab a canceled one
      subId = sub?.id ?? null;
    }
    // Nothing to reconcile from → leave state as-is (the webhook owns cancellations).
    if (!sub || !subId) return NextResponse.json(await accountView(db, user.uid, user.email));

    // 2) Stamp accountId onto the sub (idempotent) so future webhook events resolve; persist the
    //    sub id ONLY when it is good-standing, so a canceled sub can't overwrite a live one.
    if (sub.metadata?.accountId !== user.uid) {
      await stripe.subscriptions.update(subId, { metadata: { ...(sub.metadata ?? {}), accountId: user.uid } });
    }
    if (GOOD.has(sub.status) && acct?.stripeSubscriptionId !== subId) {
      await acctRef.set({ stripeSubscriptionId: subId, updatedAt: now }, { merge: true });
    }

    // 3) Load the caller's owned domains.
    const ownedSnap = await db.collection("domains").where("accountId", "==", user.uid).get();
    const ownedDocs = ownedSnap.docs;

    // 4) UNAMBIGUOUS forced-bind only. An owned domain is "bound" if a line item already carries its
    //    name, or its doc's recorded item id is a live item. If EXACTLY ONE item lacks a domain AND
    //    EXACTLY ONE owned domain is unbound, they must be each other's — bind them. Any ambiguity
    //    (more than one of either) → do nothing, so we never guess the wrong domain onto a paid item.
    const itemIds = new Set(sub.items.data.map((i) => i.id));
    const tagged = new Set(sub.items.data.map((i) => lc(i.metadata?.domain)).filter(Boolean));
    const isBound = (doc: (typeof ownedDocs)[number]) => {
      const itemId = (doc.data() as DomainRecord).stripeSubscriptionItemId ?? null;
      return tagged.has(lc(doc.id)) || (itemId != null && itemIds.has(itemId));
    };
    const untaggedItems = sub.items.data.filter((i) => !i.metadata?.domain);
    const unboundDomains = ownedDocs.filter((d) => !isBound(d));
    if (untaggedItems.length === 1 && unboundDomains.length === 1) {
      const it = untaggedItems[0];
      const dd = unboundDomains[0];
      await stripe.subscriptionItems.update(it.id, { metadata: { ...(it.metadata ?? {}), domain: dd.id } });
      await dd.ref.set({ stripeSubscriptionItemId: it.id, updatedAt: now }, { merge: true });
    }

    // 5) Re-fetch (after any stamp) and reconcile the account's standing.
    const fresh = await stripe.subscriptions.retrieve(subId);
    const reconciled = reconcileSubscription(fresh as unknown as StripeSubscriptionLike);
    await acctRef.set(
      {
        subscriptionStatus: reconciled.subscriptionStatus,
        currentPeriodEnd: reconciled.currentPeriodEnd,
        cancelAt: reconciled.cancelAt,
        updatedAt: now,
      },
      { merge: true },
    );

    // 6) Per-domain mobileActive, funded-aware: a domain is on iff the sub is good-standing AND it is
    //    named by a live item OR its recorded item id is still present. This never switches off a
    //    genuinely-paid domain whose item metadata went missing (Finding: wrongful deactivation).
    const subGood = GOOD.has(fresh.status);
    const freshItemIds = new Set(fresh.items.data.map((i) => i.id));
    const freshTagged = new Set(fresh.items.data.map((i) => lc(i.metadata?.domain)).filter(Boolean));
    const batch = db.batch();
    let changed = 0;
    for (const d of ownedDocs) {
      const rec = d.data() as DomainRecord;
      if (rec.manualEntitlement) continue; // admin comp — never touched by Stripe reconciliation
      const itemId = rec.stripeSubscriptionItemId ?? null;
      const funded = subGood && (freshTagged.has(lc(d.id)) || (itemId != null && freshItemIds.has(itemId)));
      if (!!rec.mobileActive !== funded) {
        batch.update(d.ref, { mobileActive: funded, updatedAt: now });
        changed++;
      }
    }
    if (changed > 0) await batch.commit();

    return NextResponse.json(await accountView(db, user.uid, user.email));
  } catch (e) {
    console.error("[hub] POST /api/account/reconcile failed:", e);
    return NextResponse.json(
      { error: "reconcile_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
