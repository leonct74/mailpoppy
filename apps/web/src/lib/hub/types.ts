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
}

export type ResolveResult =
  | { ok: true; deployment: DeploymentConfig }
  | { ok: false; reason: "unknown_domain" | "inactive_subscription" };
