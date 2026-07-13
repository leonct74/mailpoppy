// Shared types for the MailPoppy Hub (account/billing/directory plane).
// See mailpoppy-strategy/mailpoppy-hub-design.md.

/** The PUBLIC connection details of a customer's deployed backend (no secrets). */
export interface DeploymentConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";

/** A MailPoppy account = the admin who deploys a backend and pays. Firestore `accounts/{uid}`.
 *  PER-DOMAIN billing: one account holds ONE Stripe subscription whose line items are the
 *  domains it has activated mobile/web client access for. `subscriptionStatus` reflects the
 *  whole subscription (payment standing); which domains are on is tracked per-domain below. */
export interface AccountRecord {
  email: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: number | null; // epoch ms (Firestore Timestamp normalised to millis)
  /** When set, the subscription is scheduled to cancel at this epoch-ms (cancel_at_period_end):
   *  access continues until then, after which the gate blocks. null = not scheduled to cancel. */
  cancelAt?: number | null;
}

/** A directory entry: which deployment serves a given email domain. */
export interface DomainRecord {
  domain: string; // lowercased, e.g. "acme.com"
  accountId: string | null; // owning MailPoppy account (null for manually-seeded entries)
  deployment: DeploymentConfig;
  verified: boolean;
  /** Has this domain's end-user client access (mobile + web) been ACTIVATED (and funded)?
   *  Set true when its Stripe line item is added, false when removed. The resolve gate
   *  requires this AND the owning account being in good standing. */
  mobileActive?: boolean;
  /** The Stripe subscription line item that funds this domain's client access. */
  stripeSubscriptionItemId?: string | null;
  /** ADMIN COMP: when true, this domain is entitled REGARDLESS of Stripe/account standing —
   *  the paywall is bypassed. For MailPoppy's own operators to grant access (testing, comps,
   *  partners) without a subscription. Set via the admin API (POST /api/admin/domains). Kept
   *  separate from `mobileActive` so Stripe reconciliation never clobbers a comp. */
  manualEntitlement?: boolean;
  /** AGENTSPOPPY IN-APP PURCHASE: mirror of "this domain was bought through AgentsPoppy's checkout"
   *  (the `domain-access` product, target = this domain). Set by the AgentsPoppy purchase webhook
   *  (POST /api/agentspoppy/purchase) or a live entitlement check during resolve. AgentsPoppy is the
   *  source of truth; this is a cached copy so the resolve gate stays a fast Firestore read. Kept
   *  separate from the legacy Stripe `mobileActive` so the two paths don't clobber each other. */
  agentspoppyEntitled?: boolean;
}

export type ResolveResult =
  | { ok: true; deployment: DeploymentConfig }
  | { ok: false; reason: "unknown_domain" | "inactive_subscription" };
