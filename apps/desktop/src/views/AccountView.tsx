import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { loadInventory as defaultLoadInventory, type Inventory } from "../lib/resources";
import { resolveStackName } from "../lib/deploymentConfig";
import { PolicyEditor } from "./PolicyEditor";
import { RetentionEditor } from "./RetentionEditor";
import { ResourcesView } from "./ResourcesView";
import { Card, Spinner } from "../ui";

// Account — the home for everything that is shared across the whole install
// rather than scoped to a single domain. There is ONE backend per install (one
// stack, one user pool, one SES rule set), so mail rules and retention are
// account-wide, and the AWS resource inventory + teardown act on that one
// backend. Per-domain concerns (DNS/DKIM, mailboxes, migration, inbox) live in
// the domain workspace instead; first-domain onboarding lives in Setup.

export function AccountView({
  stackName = resolveStackName(),
  loadInventory = defaultLoadInventory,
}: {
  stackName?: string;
  loadInventory?: (stackName: string) => Promise<Inventory>;
}) {
  // Mail rules + retention read/write a deployed backend's settings, so only
  // surface them once a backend exists — otherwise their endpoints 404 and the
  // editors would show a raw error. A single cheap inventory check gates them.
  const [hasBackend, setHasBackend] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadInventory(stackName)
      .then((inv) => !cancelled && setHasBackend(inv.stackExists))
      .catch(() => !cancelled && setHasBackend(false));
    return () => {
      cancelled = true;
    };
  }, [stackName, loadInventory]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-mono text-xs uppercase tracking-wider text-primary">Account</div>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-on-surface">
          <SlidersHorizontal className="size-5 text-primary" />
          Account &amp; infrastructure
        </h2>
        <p className="mt-1 max-w-2xl text-on-surface-variant">
          Settings and resources shared across every domain on this backend — your mail rules, how long mail is kept,
          and the AWS resources Mailpoppy manages.
        </p>
      </div>

      {/* Shared, account-wide settings. */}
      {hasBackend === null ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner /> Loading account settings…
          </div>
        </Card>
      ) : hasBackend ? (
        <>
          <Card>
            <PolicyEditor stackName={stackName} />
          </Card>
          <Card>
            <RetentionEditor stackName={stackName} />
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-sm text-on-surface-variant">
            Mail rules and retention apply to a deployed backend. Deploy one from the{" "}
            <b className="text-on-surface">Setup</b> tab first — they'll appear here afterwards.
          </p>
        </Card>
      )}

      {/* AWS resource inventory + teardown (self-loads; handles no-backend itself). */}
      <ResourcesView stackName={stackName} />
    </div>
  );
}
