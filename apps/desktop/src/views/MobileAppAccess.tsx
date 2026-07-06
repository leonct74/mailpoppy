import { useEffect, useState } from "react";
import { Smartphone, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, Button } from "../ui";
import { openExternal } from "../lib/openExternal";
import { activationUrl, checkHubDomain, type DeploymentForHub, type HubDomainStatus } from "../lib/hubAccount";

// Per-domain "activate the mobile app" panel. It does NOT sign anyone in or take payment — it just
// opens the website's pricing/activation page for this domain (carrying the domain's public backend
// config), where the admin signs in or signs up, sees the price + terms, and subscribes.
//
// It also checks the Hub for a STALE config: if the domain is entitled but the Hub points at an old
// backend (e.g. this domain was torn down + redeployed → new Cognito pool), mobile sign-in breaks
// with a cryptic "user pool client does not exist". We surface that and offer a one-click refresh —
// which re-registers the LIVE config through the same activation funnel (signing in re-registers; no
// new charge for an already-active domain, handled on the /activate page).
export function MobileAppAccess({
  domain,
  deployment,
}: {
  domain: string;
  deployment: DeploymentForHub | null;
}) {
  const [status, setStatus] = useState<HubDomainStatus | "loading">("loading");

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

  const open = () => deployment && void openExternal(activationUrl(domain, deployment));

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
            mailboxes here can sign in from anywhere.
          </p>
          <Button className="mt-3" disabled={!deployment} onClick={open}>
            See the pricing →
          </Button>
        </>
      )}
    </Card>
  );
}
