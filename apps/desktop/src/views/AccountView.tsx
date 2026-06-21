import { SlidersHorizontal, ShieldCheck } from "lucide-react";
import { resolveStackName } from "../lib/deploymentConfig";
import { SendingAccessView } from "./SendingAccessView";
import { SendSettingsEditor } from "./SendSettingsEditor";
import { ResourcesView } from "./ResourcesView";
import { AgentsPoppyConnect } from "./AgentsPoppyConnect";
import { Card } from "../ui";

// Account — the home for what's genuinely shared across the whole install rather
// than scoped to a single domain. There is ONE backend per install (one stack,
// one user pool, one SES rule set), so this is where SES sending access (an AWS
// account+region property) and the AWS resource inventory live. Per-domain
// concerns — DNS/DKIM, mailboxes, migration, inbox, mail rules + retention, and
// teardown — live in each domain's workspace instead. There is deliberately no
// "remove everything" control here; teardown is per-domain only.

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

      {/* How MailPoppy gets its AWS credentials. Optional: route them through a
          local AgentsPoppy broker so it can monitor + tear down what MailPoppy
          deploys. Install-wide (one credential source), so it lives here. */}
      <Card>
        <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
          <ShieldCheck className="size-4 text-primary" /> AWS credential source
        </h3>
        <p className="mt-1 text-sm text-on-surface-variant">
          By default MailPoppy uses your local AWS profile. You can instead connect through{" "}
          <b className="text-on-surface">AgentsPoppy</b> — a local broker that vends short-lived, scoped credentials and
          can pause, revoke, or tear down what MailPoppy creates.
        </p>
        <AgentsPoppyConnect />
      </Card>

      {/* Sending access is an AWS account+region property (SES sandbox →
          production), not per-domain — it lives here. */}
      <Card>
        <SendingAccessView />
      </Card>

      {/* Sending health lives in its own sidebar view ("Sending health"), per
          domain — not here. */}

      {/* Max outgoing attachment size — deployment-wide (one backend, one limit). */}
      <Card>
        <SendSettingsEditor stackName={stackName} />
      </Card>

      {/* AWS resource inventory — read-only (self-loads; handles no-backend itself).
          Teardown is per-domain, in each domain's workspace. */}
      <ResourcesView stackName={stackName} />
    </div>
  );
}
