import { useCallback, useEffect, useState } from "react";
import { Smartphone, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, Button } from "../ui";
import { openExternal } from "../lib/openExternal";
import { startDomainCheckout, openBillingPortal, isDomainPurchased } from "../lib/commerce";
import { activationUrl, checkHubDomain, type DeploymentForHub, type HubDomainStatus } from "../lib/hubAccount";

// Per-domain "mobile app" panel. Access is bought through AgentsPoppy's in-app checkout (the
// `domain-access` product, scoped to this domain). This panel reflects TWO facts:
//   • purchased? — the AgentsPoppy entitlement for this domain (did they pay / is it comped upstream);
//   • hub status — whether the Hub has this domain's LIVE backend registered (so mobile can resolve it).
// A domain can be paid-for but not yet linked to the Hub (registration is a separate one-time sign-in),
// so we guide "purchased but not linked" → "Finish setup". It re-checks whenever you return to the app,
// so the panel updates after you pay or link in the browser without a manual reload.

/** Turn an /api/checkout error code into one calm sentence. */
function friendlyCheckoutError(code: string): string {
  if (code === "not_for_sale" || code === "listing_incomplete")
    return "Mobile access isn’t on sale yet — it hasn’t been set up in the store.";
  if (code === "network_error" || code.startsWith("checkout_failed"))
    return "Couldn’t reach the store. Check your connection and try again.";
  return "Couldn’t start checkout. Please try again.";
}

export function MobileAppAccess({
  domain,
  deployment,
}: {
  domain: string;
  deployment: DeploymentForHub | null;
}) {
  const [status, setStatus] = useState<HubDomainStatus | "loading">("loading");
  const [purchased, setPurchased] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null); // shown if the OS hand-off failed

  // Read both truths: the AgentsPoppy purchase state (target = domain) and the Hub's registration
  // status for the live backend. Both are best-effort — a failure leaves the safe default.
  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([
      isDomainPurchased(domain).catch(() => false),
      deployment
        ? checkHubDomain(domain, deployment).catch((): HubDomainStatus => "unknown")
        : Promise.resolve<HubDomainStatus>("unknown"),
    ]);
    setPurchased(p);
    setStatus(s);
  }, [domain, deployment]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      const [p, s] = await Promise.all([
        isDomainPurchased(domain).catch(() => false),
        deployment
          ? checkHubDomain(domain, deployment).catch((): HubDomainStatus => "unknown")
          : Promise.resolve<HubDomainStatus>("unknown"),
      ]);
      if (!cancelled) {
        setPurchased(p);
        setStatus(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, deployment]);

  // Re-check when the user returns to the app (after paying or linking in the system browser), so the
  // panel updates without a manual reload.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Buy this domain's access through AgentsPoppy's in-app checkout.
  const buy = async () => {
    setBusy(true);
    setErr(null);
    setFallbackUrl(null);
    const r = await startDomainCheckout(domain);
    setBusy(false);
    if (!r.ok) setErr(friendlyCheckoutError(r.error));
    else if (!r.opened) setFallbackUrl(r.url);
  };

  // Link the domain to the Hub (register its live backend) via a quick sign-in — needed once so the
  // mobile/web apps can resolve this domain. Also the "stale config" refresh path.
  const linkDomain = async () => {
    if (!deployment) return;
    setBusy(true);
    setErr(null);
    setFallbackUrl(null);
    const url = activationUrl(domain, deployment);
    const opened = await openExternal(url);
    setBusy(false);
    if (!opened) setFallbackUrl(url);
  };

  // Open the Stripe billing portal (manage / cancel / invoices) for this domain.
  const manage = async () => {
    setBusy(true);
    setErr(null);
    setFallbackUrl(null);
    const r = await openBillingPortal();
    setBusy(false);
    if (!r.ok) setErr("Couldn’t open the billing portal. Please try again.");
    else if (!r.opened) setFallbackUrl(r.url);
  };

  // Shared "browser didn't open" fallback + error.
  const feedback = (
    <>
      {err && <p className="mt-2 text-sm text-warn-bright">{err}</p>}
      {fallbackUrl && (
        <div className="mt-2 text-sm text-on-surface-variant">
          <p>Couldn’t open your browser automatically. Copy this link to continue:</p>
          <code className="mt-1 block break-all rounded bg-surface-container p-2 text-xs text-on-surface">
            {fallbackUrl}
          </code>
        </div>
      )}
    </>
  );

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-primary" />
        <h3 className="font-semibold text-on-surface">MailPoppy mobile app</h3>
      </div>

      {status === "loading" ? (
        <p className="mt-2 text-sm text-on-surface-variant">Checking…</p>
      ) : status === "stale" ? (
        <>
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn-bright">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <b className="text-on-surface">Mobile settings are out of date.</b> The email service for{" "}
              <b>{domain}</b> was rebuilt, so the mobile &amp; web apps still point at the old one — people can&apos;t
              sign in until you refresh it. It takes a few seconds and won&apos;t charge you again.
            </span>
          </div>
          <Button className="mt-3" disabled={!deployment || busy} onClick={() => void linkDomain()}>
            <RefreshCw className="size-4" /> Update mobile settings
          </Button>
          {feedback}
        </>
      ) : status === "current" ? (
        // Registered + entitled → confirm it's on, and offer billing management.
        <>
          <div className="mt-1.5 flex items-start gap-1.5 text-sm text-on-surface-variant">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-secondary" />
            <span>
              <b className="text-on-surface">On for {domain}.</b> Everyone with a mailbox here signs in with the{" "}
              <b className="text-on-surface">MailPoppy</b> app on iPhone, Android and the web — coming soon to the App
              Store &amp; Google Play.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void manage()}
            disabled={busy}
            className="mt-2 text-sm text-on-surface-variant underline hover:text-on-surface disabled:opacity-60"
          >
            {busy ? "Opening…" : "Manage billing"}
          </button>
          {feedback}
        </>
      ) : purchased ? (
        // Paid for in AgentsPoppy, but the Hub doesn't have this domain's backend yet → one-time link.
        <>
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-secondary/30 bg-secondary/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-secondary" />
            <span className="text-on-surface-variant">
              <b className="text-on-surface">Purchased — one step left.</b> Mobile access for <b>{domain}</b> is paid
              for. Link the domain so the apps can find your backend — a quick one-time sign-in.
            </span>
          </div>
          <Button className="mt-3" disabled={!deployment || busy} onClick={() => void linkDomain()}>
            {busy ? "Opening…" : "Finish setup →"}
          </Button>
          <p className="mt-2 text-xs text-on-surface-variant">Updates here automatically when you come back.</p>
          {feedback}
        </>
      ) : (
        // Not purchased → the in-app purchase.
        <>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
            Activate the MailPoppy mobile app for <b className="text-on-surface">{domain}</b>, so the people with
            mailboxes here can sign in from anywhere. You pay once for this domain, through AgentsPoppy.
          </p>
          <Button className="mt-3" disabled={busy} onClick={() => void buy()}>
            {busy ? "Opening checkout…" : "Set up mobile access →"}
          </Button>
          <p className="mt-2 text-xs text-on-surface-variant">Updates here automatically when you come back.</p>
          {feedback}
        </>
      )}
    </Card>
  );
}
