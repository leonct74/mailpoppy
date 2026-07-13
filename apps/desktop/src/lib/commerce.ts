// Buy a domain's mobile/web client access through AgentsPoppy's in-app checkout — MailPoppy's
// paywall runs through AgentsPoppy now (the first-party `domain-access` product, `target` = the
// domain), not MailPoppy's own Stripe. This replaces the old "open mailpoppy.com/activate" steering.
//
// Flow: POST agentspoppy.com/api/checkout → a hosted Stripe Checkout URL → open it in the OS browser
// (openExternal handles both the standalone Tauri window and the AgentsPoppy-container iframe). On
// completion AgentsPoppy writes the entitlement (target = domain) and pushes it to the Hub, which
// flips the domain on — so the desktop needs no callback; its Hub status poll reflects it.
import { openExternal } from "./openExternal";

// Where the AgentsPoppy commerce plane lives. Override for staging via localStorage.
const AGENTSPOPPY_BASE = (
  (typeof localStorage !== "undefined" && localStorage.getItem("mailpoppy.agentspoppyUrl")) ||
  "https://agentspoppy.com"
).replace(/\/$/, "");

// MailPoppy's poppy id + the product that unlocks a domain (must match what's priced in the
// AgentsPoppy admin dashboard).
const POPPY_ID = "com.mailpoppy.desktop";
const DOMAIN_ACCESS_PRODUCT = "domain-access";

// A stable, OPAQUE per-install buyer id (mirrors the AgentsPoppy host). It's unguessable, which
// matters: it's the capability that lets this install open its own billing portal. (A guessable id
// like the domain would let anyone open — and cancel — someone else's subscription.) Entitlement is
// still checked by `target` = the domain, so this id never gates access; it only ties billing to
// this install.
const BUYER_KEY = "mailpoppy.buyerId";
function buyerId(): string {
  let id = localStorage.getItem(BUYER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(BUYER_KEY, id);
  }
  return id;
}

export type CheckoutResult =
  | { ok: true; url: string; opened: boolean }
  | { ok: false; error: string };

/**
 * Start the AgentsPoppy checkout for a domain's access and open it in the browser. `buyerId` is keyed
 * to the domain (one buyer/entitlement per domain; the Hub gates on `target` = domain, not the buyer).
 * Returns the checkout URL + whether it was handed to the browser — so a caller can show a fallback
 * link if the OS hand-off failed (e.g. a stale Tauri build whose opener plugin isn't active yet).
 */
export async function startDomainCheckout(domain: string): Promise<CheckoutResult> {
  let url: string;
  try {
    const res = await fetch(`${AGENTSPOPPY_BASE}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poppyId: POPPY_ID,
        productId: DOMAIN_ACCESS_PRODUCT,
        target: domain,
        buyerId: buyerId(),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !j.url) return { ok: false, error: j.error || `checkout_failed_${res.status}` };
    url = j.url;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
  const opened = await openExternal(url);
  return { ok: true, url, opened };
}

/**
 * Open the buyer's billing portal (Stripe-hosted) so they can cancel the subscription, update their
 * card, or see invoices. Keyed by this install's opaque buyerId. Returns the portal URL + whether it
 * opened (so a caller can show a fallback link if the OS hand-off failed).
 */
export async function openBillingPortal(): Promise<CheckoutResult> {
  let url: string;
  try {
    const res = await fetch(`${AGENTSPOPPY_BASE}/api/billing-portal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poppyId: POPPY_ID, buyerId: buyerId() }),
    });
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !j.url) return { ok: false, error: j.error || `portal_failed_${res.status}` };
    url = j.url;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
  const opened = await openExternal(url);
  return { ok: true, url, opened };
}

/** Is this domain currently purchased in AgentsPoppy? (target-scoped, no buyer needed.) Best-effort:
 *  returns false on any error. Mostly the Hub's resolve gate is authoritative — this is for showing
 *  status in the desktop without waiting on the Hub mirror. */
export async function isDomainPurchased(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${AGENTSPOPPY_BASE}/api/entitlement?poppyId=${encodeURIComponent(POPPY_ID)}` +
        `&productId=${encodeURIComponent(DOMAIN_ACCESS_PRODUCT)}&target=${encodeURIComponent(domain)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return false;
    const j = (await res.json()) as { entitled?: boolean };
    return j.entitled === true;
  } catch {
    return false;
  }
}
