import { useEffect, useState } from "react";
import { Smartphone, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, Button } from "../ui";
import { openExternal } from "../lib/openExternal";
import { startDomainCheckout } from "../lib/commerce";
import { activationUrl, checkHubDomain, type DeploymentForHub, type HubDomainStatus } from "../lib/hubAccount";

// Per-domain "activate the mobile app" panel. Buying access runs through AgentsPoppy's in-app
// checkout (the `domain-access` product, scoped to this domain) — the desktop opens the hosted
// checkout in the browser; once paid, AgentsPoppy tells the Hub and the domain switches on.
//
// It also checks the Hub for a STALE config: if the domain is entitled but the Hub points at an old
// backend (e.g. this domain was torn down + redeployed → new Cognito pool), mobile sign-in breaks
// with a cryptic "user pool client does not exist". We surface that and offer a one-click refresh —
// which re-registers the LIVE config (no new charge for an already-active domain).

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
  const [buying, setBuying] = useState(false);
  const [buyErr, setBuyErr] = useState<string | null>(null);
  const [buyUrl, setBuyUrl] = useState<string | null>(null); // fallback link if the OS hand-off failed

  useEffect(() => {
    if (!deployment) return;
    let cancelled = false;
    setStatus("loading");
    void checkHubDomain(domain, deployment).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [domain, deployment]);

  // Stale-config refresh: re-register the LIVE backend via the activation page (NOT a payment).
  const open = () => deployment && void openExternal(activationUrl(domain, deployment));

  // Buy this domain's access through AgentsPoppy's in-app checkout.
  const buy = async () => {
    setBuying(true);
    setBuyErr(null);
    setBuyUrl(null);
    const r = await startDomainCheckout(domain);
    setBuying(false);
    if (!r.ok) setBuyErr(friendlyCheckoutError(r.error));
    else if (!r.opened) setBuyUrl(r.url); // browser didn't open — offer the link
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-primary" />
        <h3 className="font-semibold text-on-surface">MailPoppy mobile app</h3>
      </div>

      {status === "stale" ? (
        <>
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn-bright">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <b className="text-on-surface">Mobile settings are out of date.</b> The email service for{" "}
              <b>{domain}</b> was rebuilt, so the mobile &amp; web apps still point at the old one — people can&apos;t
              sign in until you refresh it. It takes a few seconds and won&apos;t charge you again.
            </span>
          </div>
          <Button className="mt-3" disabled={!deployment} onClick={open}>
            <RefreshCw className="size-4" /> Update mobile settings
          </Button>
        </>
      ) : status === "current" ? (
        // Subscribed/entitled + config current → a compact reminder, NOT the big sign-up panel
        // (which reads like they haven't paid). Just confirms it's on and names the app to use.
        <div className="mt-1.5 flex items-start gap-1.5 text-sm text-on-surface-variant">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-secondary" />
          <span>
            <b className="text-on-surface">On for {domain}.</b> Everyone with a mailbox here signs in with the{" "}
            <b className="text-on-surface">MailPoppy</b> app on iPhone, Android and the web — coming soon to the App
            Store &amp; Google Play.
          </span>
        </div>
      ) : (
        <>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
            Activate the MailPoppy mobile app for <b className="text-on-surface">{domain}</b>, so the people with
            mailboxes here can sign in from anywhere. You pay once for this domain, through AgentsPoppy.
          </p>
          <Button className="mt-3" disabled={buying} onClick={() => void buy()}>
            {buying ? "Opening checkout…" : "Set up mobile access →"}
          </Button>
          {buyErr && <p className="mt-2 text-sm text-warn-bright">{buyErr}</p>}
          {buyUrl && (
            <div className="mt-2 text-sm text-on-surface-variant">
              <p>Couldn’t open your browser automatically. Copy this link to finish your purchase:</p>
              <code className="mt-1 block break-all rounded bg-surface-container p-2 text-xs text-on-surface">{buyUrl}</code>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
