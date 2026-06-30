import { Smartphone } from "lucide-react";
import { Card, Button } from "../ui";
import { openExternal } from "../lib/openExternal";
import { activationUrl, type DeploymentForHub } from "../lib/hubAccount";

// Per-domain "activate the mobile app" panel. It does NOT sign anyone in or take payment — it just
// opens the website's pricing/activation page for this domain (carrying the domain's public backend
// config), where the admin signs in or signs up, sees the price + terms, and subscribes.
export function MobileAppAccess({
  domain,
  deployment,
}: {
  domain: string;
  deployment: DeploymentForHub | null;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-primary" />
        <h3 className="font-semibold text-on-surface">MailPoppy mobile app</h3>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
        Activate the MailPoppy mobile app for <b className="text-on-surface">{domain}</b>, so the people with
        mailboxes here can sign in from anywhere.
      </p>
      <Button
        className="mt-3"
        disabled={!deployment}
        onClick={() => deployment && void openExternal(activationUrl(domain, deployment))}
      >
        See the pricing →
      </Button>
    </Card>
  );
}
