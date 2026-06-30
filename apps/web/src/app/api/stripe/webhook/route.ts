// POST /api/stripe/webhook — Stripe → Hub state sync. Signature-verified; on subscription
// lifecycle events it reconciles the Stripe subscription to the account's payment standing
// and which domains are active (DomainRecord.mobileActive). Inert (503) until STRIPE_SECRET_KEY
// + STRIPE_WEBHOOK_SECRET are set, so an un-provisioned env never crashes.
//
// CONVENTION (set by Checkout): the subscription carries metadata.accountId = the Firebase uid
// of the owning account; each line item carries metadata.domain. See stripeReconcile.ts.
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, stripeWebhookSecret } from "@/lib/hub/stripeClient";
import { getDb } from "@/lib/hub/firestore";
import { reconcileSubscription, type StripeSubscriptionLike } from "@/lib/hub/stripeReconcile";
import { applyReconciledState } from "@/lib/hub/hubWrites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function accountIdOf(sub: Stripe.Subscription): string | null {
  const id = sub.metadata?.accountId;
  return typeof id === "string" && id ? id : null;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  // Raw body is required for signature verification — never parse it first.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.warn("[hub] webhook signature verification failed:", e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const accountId = accountIdOf(sub);
        if (!accountId) {
          console.warn("[hub] subscription event without metadata.accountId:", sub.id);
          break;
        }
        const db = getDb();
        if (!db) break;
        const state =
          event.type === "customer.subscription.deleted"
            ? { subscriptionStatus: "canceled" as const, currentPeriodEnd: null, activeDomains: [] }
            : reconcileSubscription(sub as unknown as StripeSubscriptionLike);
        await applyReconciledState(db, accountId, state);
        break;
      }
      case "checkout.session.completed": {
        // First-domain activation: the new subscription has no per-item metadata yet (Checkout
        // can't set it). Stamp accountId on the subscription + domain on its first item, record
        // the ids, then reconcile so the gate sees the domain as active.
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = session.metadata?.accountId;
        const domain = session.metadata?.domain;
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!accountId || !domain || !subId) break;

        const sub = await stripe.subscriptions.retrieve(subId);
        if (sub.metadata?.accountId !== accountId) {
          await stripe.subscriptions.update(subId, { metadata: { ...sub.metadata, accountId } });
        }
        const firstItem = sub.items.data[0];
        if (firstItem && firstItem.metadata?.domain !== domain) {
          await stripe.subscriptionItems.update(firstItem.id, { metadata: { domain } });
        }

        const db = getDb();
        if (db) {
          await db
            .collection("accounts")
            .doc(accountId)
            .set({ stripeSubscriptionId: subId, updatedAt: Date.now() }, { merge: true });
          if (firstItem) {
            await db
              .collection("domains")
              .doc(domain)
              .set({ stripeSubscriptionItemId: firstItem.id, updatedAt: Date.now() }, { merge: true });
          }
          const fresh = await stripe.subscriptions.retrieve(subId);
          await applyReconciledState(
            db,
            accountId,
            reconcileSubscription(fresh as unknown as StripeSubscriptionLike),
          );
        }
        break;
      }
      default:
        // Other events (invoice.*, etc.) carry no state we don't already get above. Acknowledge
        // so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error("[hub] webhook handler error:", e);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
