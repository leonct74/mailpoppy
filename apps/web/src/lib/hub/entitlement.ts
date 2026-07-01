// Pure entitlement logic for the Hub's resolve gate — NO Firestore, fully unit-tested.
//
// PER-DOMAIN model (decided 2026-06-30): an admin (account) holds ONE Stripe subscription
// with one line item per domain they activate. A domain's end-user client access (mobile +
// web) is entitled when BOTH are true:
//   1. the domain has been activated  (DomainRecord.mobileActive), and
//   2. the owning account's subscription is in good standing.
// So the account's payment status gates ALL its domains, while the per-domain flag selects
// WHICH ones are on (lets an admin enable A + B but not C). `past_due` gets a grace window
// so one failed card doesn't instantly lock a whole company out (hub design doc §7).
import type { AccountRecord } from "./types";

export const GRACE_DAYS_DEFAULT = 7;
const DAY_MS = 86_400_000;

/** The subset of an account the gate needs (so callers/tests needn't build a whole record). */
export type AccountStanding = Pick<AccountRecord, "subscriptionStatus" | "currentPeriodEnd">;

/** Is the account's subscription currently honoured (active/trialing, or past_due within grace)? */
export function accountInGoodStanding(
  account: AccountStanding | null | undefined,
  nowMs: number,
  graceDays: number = GRACE_DAYS_DEFAULT,
): boolean {
  if (!account) return false;
  switch (account.subscriptionStatus) {
    case "active":
    case "trialing":
      return true;
    case "past_due": {
      // A failed payment shouldn't lock the customer out instantly; honour until the
      // current period end + grace. If we don't know the period end, stay lenient.
      if (account.currentPeriodEnd == null) return true;
      return nowMs <= account.currentPeriodEnd + graceDays * DAY_MS;
    }
    default: // "none" | "canceled"
      return false;
  }
}

/** Is THIS domain's client access entitled right now? An admin comp (`manualEntitlement`)
 *  bypasses the paywall entirely; otherwise it must be activated AND its account in good
 *  standing. */
export function isDomainEntitled(
  domain: { mobileActive?: boolean; manualEntitlement?: boolean } | null | undefined,
  account: AccountStanding | null | undefined,
  nowMs: number,
  graceDays: number = GRACE_DAYS_DEFAULT,
): boolean {
  if (domain?.manualEntitlement) return true; // admin comp — no Stripe/account required
  if (!domain?.mobileActive) return false;
  return accountInGoodStanding(account, nowMs, graceDays);
}
