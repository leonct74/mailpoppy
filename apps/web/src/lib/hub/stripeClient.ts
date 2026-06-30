// Lazy Stripe client for the Hub. Mirrors firestore.ts: everything is defensive — if
// STRIPE_SECRET_KEY isn't set (local/un-provisioned env), getStripe() returns null and
// callers respond "not configured" rather than crashing. No secret ever ships to the client.
import Stripe from "stripe";

let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  if (!cached) console.warn("[hub] STRIPE_SECRET_KEY unset; Stripe features disabled");
  return cached;
}

/** The webhook signing secret (whsec_…) used to verify event authenticity. */
export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

/** The recurring Price a domain's mobile access is billed against (one line item per domain). */
export function stripePriceId(): string | null {
  return process.env.STRIPE_PRICE_ID ?? null;
}
