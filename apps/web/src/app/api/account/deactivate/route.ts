// POST /api/account/deactivate { domain } — turn mobile access off for one domain. Removes that
// domain's line item from the subscription; if it was the last item, cancels the whole
// subscription. Sets mobileActive=false immediately (the subscription.* webhook also reconciles).
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
  const acct = (await db.collection("accounts").doc(user.uid).get()).data() as AccountRecord | undefined;
  const subId = acct?.stripeSubscriptionId ?? null;

  if (itemId && subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.items.data.length <= 1) {
        await stripe.subscriptions.cancel(subId); // last domain → cancel the subscription
      } else {
        await stripe.subscriptionItems.del(itemId);
      }
    } catch (e) {
      console.warn("[hub] deactivate: stripe update failed:", e);
    }
  }

  await domSnap.ref.set(
    { mobileActive: false, stripeSubscriptionItemId: null, updatedAt: Date.now() },
    { merge: true },
  );
  return NextResponse.json({ ok: true });
}
