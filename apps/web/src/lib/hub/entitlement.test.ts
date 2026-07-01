import { describe, it, expect } from "vitest";
import { accountInGoodStanding, isDomainEntitled, GRACE_DAYS_DEFAULT } from "./entitlement";

const NOW = Date.UTC(2026, 5, 30); // 2026-06-30
const DAY = 86_400_000;

describe("accountInGoodStanding", () => {
  it("active and trialing are honoured", () => {
    expect(accountInGoodStanding({ subscriptionStatus: "active", currentPeriodEnd: null }, NOW)).toBe(true);
    expect(accountInGoodStanding({ subscriptionStatus: "trialing", currentPeriodEnd: null }, NOW)).toBe(true);
  });

  it("none and canceled are never honoured (even with a future period end)", () => {
    expect(accountInGoodStanding({ subscriptionStatus: "none", currentPeriodEnd: null }, NOW)).toBe(false);
    expect(
      accountInGoodStanding({ subscriptionStatus: "canceled", currentPeriodEnd: NOW + 999 * DAY }, NOW),
    ).toBe(false);
  });

  it("past_due is honoured within the grace window and cut off after", () => {
    const endedYesterday = NOW - 1 * DAY;
    expect(accountInGoodStanding({ subscriptionStatus: "past_due", currentPeriodEnd: endedYesterday }, NOW)).toBe(
      true,
    );
    const beyondGrace = NOW - (GRACE_DAYS_DEFAULT + 1) * DAY;
    expect(accountInGoodStanding({ subscriptionStatus: "past_due", currentPeriodEnd: beyondGrace }, NOW)).toBe(
      false,
    );
  });

  it("past_due with an unknown period end stays lenient", () => {
    expect(accountInGoodStanding({ subscriptionStatus: "past_due", currentPeriodEnd: null }, NOW)).toBe(true);
  });

  it("a custom grace window is respected", () => {
    const ended = NOW - 3 * DAY;
    expect(accountInGoodStanding({ subscriptionStatus: "past_due", currentPeriodEnd: ended }, NOW, 2)).toBe(false);
    expect(accountInGoodStanding({ subscriptionStatus: "past_due", currentPeriodEnd: ended }, NOW, 5)).toBe(true);
  });

  it("a missing account is never in good standing", () => {
    expect(accountInGoodStanding(null, NOW)).toBe(false);
    expect(accountInGoodStanding(undefined, NOW)).toBe(false);
  });
});

describe("isDomainEntitled", () => {
  const active = { subscriptionStatus: "active" as const, currentPeriodEnd: null };

  it("requires the domain to be activated", () => {
    expect(isDomainEntitled({ mobileActive: false }, active, NOW)).toBe(false);
    expect(isDomainEntitled({}, active, NOW)).toBe(false);
    expect(isDomainEntitled(null, active, NOW)).toBe(false);
  });

  it("activated + account in good standing → entitled", () => {
    expect(isDomainEntitled({ mobileActive: true }, active, NOW)).toBe(true);
  });

  it("activated but the account is canceled → not entitled (the account gates all its domains)", () => {
    expect(
      isDomainEntitled({ mobileActive: true }, { subscriptionStatus: "canceled", currentPeriodEnd: null }, NOW),
    ).toBe(false);
  });

  it("activated but there is no owning account → not entitled", () => {
    expect(isDomainEntitled({ mobileActive: true }, null, NOW)).toBe(false);
  });

  it("the A/B-not-C scenario: same active account, only flagged domains pass", () => {
    expect(isDomainEntitled({ mobileActive: true }, active, NOW)).toBe(true); // A
    expect(isDomainEntitled({ mobileActive: true }, active, NOW)).toBe(true); // B
    expect(isDomainEntitled({ mobileActive: false }, active, NOW)).toBe(false); // C
  });

  it("admin comp (manualEntitlement) bypasses the paywall entirely", () => {
    // Entitled with no account, no activation, even a canceled account.
    expect(isDomainEntitled({ manualEntitlement: true }, null, NOW)).toBe(true);
    expect(isDomainEntitled({ manualEntitlement: true, mobileActive: false }, null, NOW)).toBe(true);
    expect(
      isDomainEntitled(
        { manualEntitlement: true },
        { subscriptionStatus: "canceled", currentPeriodEnd: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("manualEntitlement false falls back to the normal gate", () => {
    expect(isDomainEntitled({ manualEntitlement: false, mobileActive: false }, active, NOW)).toBe(false);
    expect(isDomainEntitled({ manualEntitlement: false, mobileActive: true }, active, NOW)).toBe(true);
  });
});
