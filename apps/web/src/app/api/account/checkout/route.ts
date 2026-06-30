// POST /api/account/checkout { domain } — activate mobile access for one domain the admin owns.
// One subscription per account, one line item per domain:
//   • first domain  → Stripe Checkout (collects a card, creates the subscription)
//   • later domains → add a line item to the existing subscription (reuses the saved card)
// Either way the line item carries metadata.domain, and the subscription metadata.accountId, so
// the webhook can reconcile which domains are funded. Authed with a Firebase ID token.
import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/hub/firebaseAdmin";
import { getDb } from "@/lib/hub/firestore";
import { getStripe, stripePriceId } from "@/lib/hub/stripeClient";
import type { AccountRecord, DomainRecord } from "@/lib/hub/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const stripe = getStripe();
  const priceId = stripePriceId();
  if (!stripe || !priceId) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  const db = getDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown; returnTo?: unknown };
  const domain = String(body.domain ?? "").trim().toLowerCase();
  if (!domain) return NextResponse.json({ error: "missing_domain" }, { status: 400 });
  // Where Checkout sends the browser on success — restricted to an internal path so it can't be
  // turned into an open redirect. Defaults to the dashboard.
  const rt = String(body.returnTo ?? "");
  const returnTo = /^\/[a-z0-9/_-]*$/i.test(rt) ? rt : "/account";

  // The admin must own this domain.
  const domSnap = await db.collection("domains").doc(domain).get();
  if (!domSnap.exists || (domSnap.data() as DomainRecord).accountId !== user.uid) {
    return NextResponse.json({ error: "not_your_domain" }, { status: 403 });
  }
  if ((domSnap.data() as DomainRecord).mobileActive) {
    return NextResponse.json({ ok: true, mode: "already_active" });
  }

  // Ensure a Stripe customer for the account.
  const acctRef = db.collection("accounts").doc(user.uid);
  const acct = (await acctRef.get()).data() as AccountRecord | undefined;
  let customerId = acct?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { accountId: user.uid },
    });
    customerId = customer.id;
    await acctRef.set({ stripeCustomerId: customerId, updatedAt: Date.now() }, { merge: true });
  }

  const subId = acct?.stripeSubscriptionId ?? null;
  const hasActiveSub = !!subId && ACTIVE.has(acct?.subscriptionStatus ?? "");

  // Later domains: add a line item to the live subscription (no redirect; reuses the card).
  if (hasActiveSub && subId) {
    const item = await stripe.subscriptionItems.create({
      subscription: subId,
      price: priceId,
      quantity: 1,
      metadata: { domain },
    });
    await domSnap.ref.set({ stripeSubscriptionItemId: item.id, updatedAt: Date.now() }, { merge: true });
    // The subscription.updated webhook flips mobileActive; reflect it immediately too.
    await domSnap.ref.set({ mobileActive: true }, { merge: true });
    return NextResponse.json({ ok: true, mode: "added" });
  }

  // First domain: Stripe Checkout creates the subscription.
  const origin = req.headers.get("origin") ?? "https://mailpoppy.com";
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { accountId: user.uid } },
    metadata: { accountId: user.uid, domain },
    success_url: `${origin}${returnTo}?activated=${encodeURIComponent(domain)}`,
    cancel_url: `${origin}${returnTo}`,
  });
  return NextResponse.json({ url: session.url });
}
