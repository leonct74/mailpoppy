import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPurchaseSignature } from "./agentspoppy";

// Sign the same way AgentsPoppy's notify.ts does, so the test exercises a REAL matching signature.
function sign(body: string, secret: string, tSec: number): string {
  const mac = createHmac("sha256", secret).update(`${tSec}.${body}`).digest("hex");
  return `t=${tSec},v1=${mac}`;
}

describe("verifyPurchaseSignature", () => {
  const secret = "whsec_shared";
  const body = JSON.stringify({ type: "purchase", target: "acme.com", entitled: true });
  const now = 1_700_000_000;

  it("accepts a valid, fresh signature", () => {
    expect(verifyPurchaseSignature(sign(body, secret, now), body, secret, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyPurchaseSignature(sign(body, secret, now), body + " ", secret, now)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyPurchaseSignature(sign(body, secret, now), body, "whsec_other", now)).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance, accepts within it", () => {
    const header = sign(body, secret, now);
    expect(verifyPurchaseSignature(header, body, secret, now + 600)).toBe(false); // >5 min
    expect(verifyPurchaseSignature(header, body, secret, now + 60)).toBe(true); // <5 min
    expect(verifyPurchaseSignature(header, body, secret, now + 10_000, 0)).toBe(true); // age check off
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyPurchaseSignature(null, body, secret, now)).toBe(false);
    expect(verifyPurchaseSignature("", body, secret, now)).toBe(false);
    expect(verifyPurchaseSignature("nope", body, secret, now)).toBe(false);
    expect(verifyPurchaseSignature("t=x,v1=y", body, secret, now)).toBe(false);
  });
});
