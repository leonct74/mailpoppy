import { SlidersHorizontal } from "lucide-react";
import { resolveStackName } from "../lib/deploymentConfig";
import { SendingAccessView } from "./SendingAccessView";
import { ResourcesView } from "./ResourcesView";
import { Card } from "../ui";

// Account — the home for what's genuinely shared across the whole install rather
// than scoped to a single domain. There is ONE backend per install (one stack,
// one user pool, one SES rule set), so this is where SES sending access (an AWS
// account+region property) and the AWS resource inventory + teardown live.
// Per-domain concerns — DNS/DKIM, mailboxes, migration, inbox, and now mail rules
// + retention — live in each domain's workspace instead.

export function AccountView({ stackName = resolveStackName() }: { stackName?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-mono text-xs uppercase tracking-wider text-primary">Account</div>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-on-surface">
          <SlidersHorizontal className="size-5 text-primary" />
          Account &amp; infrastructure
        </h2>
        <p className="mt-1 max-w-2xl text-on-surface-variant">
          Settings and resources shared across every domain on this backend — your SES sending access and the AWS
          resources Mailpoppy manages. Mail rules and retention are set <b className="text-on-surface">per domain</b>,
          inside each domain's workspace.
        </p>
      </div>

      {/* Sending access is an AWS account+region property (SES sandbox →
          production), not per-domain — it lives here. */}
      <Card>
        <SendingAccessView />
      </Card>

      {/* AWS resource inventory + teardown (self-loads; handles no-backend itself). */}
      <ResourcesView stackName={stackName} />
    </div>
  );
}
