// Pure mapping from a Stripe subscription to the Hub's account/domain state — NO Stripe SDK,
// NO Firestore, fully unit-tested. The webhook receives/fetches the Stripe Subscription,
// calls reconcileSubscription(), then writes the result to Firestore:
//   accounts/{uid}.subscriptionStatus + currentPeriodEnd
//   domains/{d}.mobileActive = (d ∈ activeDomains)   // and false for this account's other domains
//
// CONVENTION: each per-domain line item carries the domain it funds in
// SubscriptionItem.metadata.domain (Checkout sets this; we fall back to price.metadata.domain).
import type { SubscriptionStatus } from "./types";

export interface StripeItemLike {
  metadata?: Record<string, string> | null;
  price?: { metadata?: Record<string, string> | null } | null;
}
export interface StripeSubscriptionLike {
  status: string;
  current_period_end?: number | null; // unix SECONDS (Stripe's unit)
  items?: { data?: StripeItemLike[] } | null;
}
export interface ReconciledState {
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: number | null; // epoch MS (what AccountRecord stores)
  activeDomains: string[]; // lowercased, deduped — the domains with a funding line item
}

/** Collapse Stripe's many subscription statuses onto the five the Hub reasons about. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    case "incomplete":
      return "none";
    default:
      return "none";
  }
}

function domainOf(item: StripeItemLike): string | null {
  const d = item.metadata?.domain ?? item.price?.metadata?.domain;
  return d ? d.trim().toLowerCase() : null;
}

export function reconcileSubscription(sub: StripeSubscriptionLike): ReconciledState {
  const cpe = sub.current_period_end;
  const domains = new Set<string>();
  for (const item of sub.items?.data ?? []) {
    const d = domainOf(item);
    if (d) domains.add(d);
  }
  return {
    subscriptionStatus: mapStripeStatus(sub.status),
    currentPeriodEnd: typeof cpe === "number" ? cpe * 1000 : null,
    activeDomains: [...domains],
  };
}
