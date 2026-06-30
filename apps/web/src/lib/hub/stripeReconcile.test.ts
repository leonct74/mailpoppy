import { describe, it, expect } from "vitest";
import { mapStripeStatus, reconcileSubscription } from "./stripeReconcile";

describe("mapStripeStatus", () => {
  it("maps the active-ish statuses", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("trialing");
    expect(mapStripeStatus("past_due")).toBe("past_due");
  });

  it("treats unpaid / canceled / expired / paused as canceled (cut off)", () => {
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("unpaid")).toBe("canceled");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeStatus("paused")).toBe("canceled");
  });

  it("treats incomplete (never paid) and anything unknown as none", () => {
    expect(mapStripeStatus("incomplete")).toBe("none");
    expect(mapStripeStatus("something_new")).toBe("none");
  });
});

describe("reconcileSubscription", () => {
  it("converts current_period_end from unix seconds to epoch ms", () => {
    const r = reconcileSubscription({ status: "active", current_period_end: 1_800_000_000, items: { data: [] } });
    expect(r.currentPeriodEnd).toBe(1_800_000_000_000);
  });

  it("is null when there is no period end", () => {
    expect(reconcileSubscription({ status: "active" }).currentPeriodEnd).toBe(null);
  });

  it("collects active domains from item metadata, lowercased and deduped", () => {
    const r = reconcileSubscription({
      status: "active",
      current_period_end: 1700,
      items: {
        data: [
          { metadata: { domain: "A.com" } },
          { metadata: { domain: "b.com" } },
          { metadata: { domain: "a.com" } }, // dup (case-insensitive)
        ],
      },
    });
    expect(r.activeDomains.sort()).toEqual(["a.com", "b.com"]);
  });

  it("falls back to price.metadata.domain when the item has none", () => {
    const r = reconcileSubscription({
      status: "active",
      items: { data: [{ price: { metadata: { domain: "c.com" } } }] },
    });
    expect(r.activeDomains).toEqual(["c.com"]);
  });

  it("ignores items with no domain metadata", () => {
    const r = reconcileSubscription({ status: "active", items: { data: [{}, { metadata: {} }] } });
    expect(r.activeDomains).toEqual([]);
  });

  it("the A/B-not-C subscription: two domain items → exactly those two active", () => {
    const r = reconcileSubscription({
      status: "active",
      items: { data: [{ metadata: { domain: "a.com" } }, { metadata: { domain: "b.com" } }] },
    });
    expect(r.subscriptionStatus).toBe("active");
    expect(r.activeDomains.sort()).toEqual(["a.com", "b.com"]);
    expect(r.activeDomains).not.toContain("c.com");
  });
});
