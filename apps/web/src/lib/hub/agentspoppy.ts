// Bridge to the AgentsPoppy commerce plane — the source of truth for whether a domain's mobile/web
// client access has been PURCHASED. MailPoppy's paywall now runs through AgentsPoppy's in-app
// checkout (the first-party `domain-access` product, `target` = the domain), instead of MailPoppy's
// own Stripe. Two touch-points:
//   • a live read — GET agentspoppy.com/api/entitlement?…&target=<domain> → { entitled } — used to
//     self-heal a missed purchase webhook during resolve; and
//   • signature verification for the push webhook AgentsPoppy sends on each purchase (see the pure
//     `verifyPurchaseSignature`, unit-tested, copied from AgentsPoppy's notify.ts so both sides agree).
import { createHmac, timingSafeEqual } from "node:crypto";

/** The AgentsPoppy site base (override for staging via env). */
export function agentsPoppyBase(): string {
  return (process.env.AGENTSPOPPY_BASE_URL?.trim() || "https://agentspoppy.com").replace(/\/$/, "");
}

/** MailPoppy's poppy id in the AgentsPoppy directory + the product that unlocks a domain. */
export const AGENTSPOPPY_POPPY_ID = process.env.AGENTSPOPPY_POPPY_ID?.trim() || "com.mailpoppy.desktop";
export const DOMAIN_ACCESS_PRODUCT = "domain-access";

/** The shared HMAC secret AgentsPoppy signs its purchase notifications with (set in this Hub's env,
 *  and in the AgentsPoppy admin's notify-config for this poppy). */
export function agentsPoppyNotifySecret(): string | null {
  return process.env.AGENTSPOPPY_NOTIFY_SECRET?.trim() || null;
}

/**
 * Live check: is this domain currently entitled in AgentsPoppy? Returns the boolean, or `null` if
 * AgentsPoppy is unreachable / errors (so callers can fall back rather than wrongly lock a domain
 * out on a transient blip). Short timeout — it sits behind a negative gate, not the hot path.
 */
export async function fetchAgentsPoppyDomainEntitled(domain: string, timeoutMs = 3500): Promise<boolean | null> {
  const url =
    `${agentsPoppyBase()}/api/entitlement` +
    `?poppyId=${encodeURIComponent(AGENTSPOPPY_POPPY_ID)}` +
    `&productId=${encodeURIComponent(DOMAIN_ACCESS_PRODUCT)}` +
    `&target=${encodeURIComponent(domain)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { entitled?: unknown };
    return j.entitled === true;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify AgentsPoppy's `X-AgentsPoppy-Signature` header (`t=<sec>,v1=<hex hmac-sha256>`) over the
 * raw body with the shared secret. PURE (crypto only) so it's unit-tested and matches AgentsPoppy's
 * signer exactly. `toleranceSec` rejects stale timestamps (replay guard); 0 disables the age check.
 */
export function verifyPurchaseSignature(
  header: string | null | undefined,
  body: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (toleranceSec > 0 && Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
