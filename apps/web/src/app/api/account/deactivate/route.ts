// POST /api/account/deactivate { domain } — stop a domain's mobile access.
//  • If it's the only/last funded domain, the whole subscription is scheduled to cancel at the END
//    of the paid period (cancel_at_period_end). Access CONTINUES until then; the gate blocks once
//    Stripe finalises the cancellation and the account goes 'canceled'. No mid-term forfeit.
//  • If other domains stay funded, this domain's line item is removed now (Stripe prorates a
//    credit toward the remaining domains) and its mobileActive is switched off.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { getStripe } from "@/lib/hub/stripeClient";
import type { AccountRecord, DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const domain = String(body.domain ?? "").trim().toLowerCase();
  if (!domain) return NextResponse.json({ error: "missing_domain" }, { status: 400 });

  const domSnap = await db.collection("domains").doc(domain).get();
  if (!domSnap.exists || (domSnap.data() as DomainRecord).accountId !== user.uid) {
    return NextResponse.json({ error: "not_your_domain" }, { status: 403 });
  }

  const itemId = (domSnap.data() as DomainRecord).stripeSubscriptionItemId ?? null;
  const acctRef = db.collection("accounts").doc(user.uid);
  const acct = (await acctRef.get()).data() as AccountRecord | undefined;
  const subId = acct?.stripeSubscriptionId ?? null;

  if (!itemId || !subId) {
    await domSnap.ref.set(
      { mobileActive: false, stripeSubscriptionItemId: null, updatedAt: Date.now() },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  }

  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    if (sub.items.data.length <= 1) {
      // Whole subscription → cancel at period end. Keep mobileActive (access stays live) until then.
      const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
      const cancelAt = typeof updated.cancel_at === "number" ? updated.cancel_at * 1000 : null;
      await acctRef.set({ cancelAt, updatedAt: Date.now() }, { merge: true });
      return NextResponse.json({ ok: true, scheduledCancel: true, cancelAt });
    }
    // One of several domains → drop this item now; Stripe prorates a credit.
    await stripe.subscriptionItems.del(itemId);
    await domSnap.ref.set(
      { mobileActive: false, stripeSubscriptionItemId: null, updatedAt: Date.now() },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[hub] deactivate failed:", e);
    return NextResponse.json(
      { error: "deactivate_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
