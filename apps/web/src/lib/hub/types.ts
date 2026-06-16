// Shared types for the MailPoppy Hub (account/billing/directory plane).
// See mailpoppy-strategy/mailpoppy-hub-design.md.

/** The PUBLIC connection details of a customer's deployed backend (no secrets). */
export interface DeploymentConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

/** A directory entry: which deployment serves a given email domain. */
export interface DomainRecord {
  domain: string; // lowercased, e.g. "acme.com"
  accountId: string | null; // owning MailPoppy account (null for manually-seeded entries)
  deployment: DeploymentConfig;
  verified: boolean;
}

export type ResolveResult =
  | { ok: true; deployment: DeploymentConfig }
  | { ok: false; reason: "unknown_domain" | "inactive_subscription" };
