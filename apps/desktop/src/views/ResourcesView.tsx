import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, RefreshCw, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, X } from "lucide-react";
import {
  loadInventory as defaultLoad,
  groupByService,
  awsConsoleUrl,
  ledgerConsoleUrl,
  type Inventory,
} from "../lib/resources";
import {
  teardownEverything as defaultTeardown,
  listProvisionedDomains as defaultListDomains,
  type TeardownResult,
} from "../lib/teardown";
import { listMailboxes as defaultListMailboxes, type Mailbox } from "../lib/mailbox";
import { resolveStackName } from "../lib/deploymentConfig";
import { Card, Button, Spinner, cn } from "../ui";

// "What Mailpoppy did to your account" (DESIGN §14.1). Shows the authoritative
// CloudFormation inventory of the deployed stack — grouped by service, every
// resource name with a console deep-link — plus the local provisioning ledger of
// out-of-stack mutations (Route53 / SES identity / rule-set activation) as a
// created/deleted timeline. The whole point is trust: no surprise resources.

type Action = "created" | "deleted" | "updated";

/** Status chip — low-opacity hue + solid text (design "Status Chips" spec). */
function ActionChip({ action }: { action: Action }) {
  const tone =
    action === "created"
      ? "bg-secondary/10 text-secondary border-secondary/20"
      : action === "updated"
        ? "bg-surface-bright text-on-surface border-outline-variant/30"
        : "bg-tertiary-container/15 text-tertiary border-tertiary/20";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs", tone)}>
      {action === "deleted" ? (
        <X className="size-3" />
      ) : (
        <span className={cn("size-1.5 rounded-full", action === "created" ? "bg-secondary" : "bg-on-surface-variant")} />
      )}
      {action}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant/5 bg-surface-container-highest/50 p-4">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-on-surface">{value}</div>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th className={cn("border-b border-outline-variant/10 px-4 py-3 text-left font-mono text-xs font-medium uppercase tracking-wider text-on-surface-variant", className)}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("border-b border-outline-variant/5 px-4 py-3 align-top text-sm", className)}>{children}</td>;
}

const consoleLink = "inline-flex items-center gap-1 text-primary hover:text-primary-container hover:underline";

export function ResourcesView({
  stackName = resolveStackName(),
  load = defaultLoad,
  teardown = defaultTeardown,
  listMailboxes = defaultListMailboxes,
  listDomains = defaultListDomains,
}: {
  stackName?: string;
  load?: (stackName: string) => Promise<Inventory>;
  teardown?: typeof defaultTeardown;
  listMailboxes?: (stackName: string) => Promise<{ mailboxes: Mailbox[] }>;
  listDomains?: (stackName: string) => Promise<{ domains: string[] }>;
}) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Danger zone (remove everything). Collapsed by default + pinned near the top
  // so it's discoverable without scrolling past a long resource list, but can't
  // be triggered by an accidental click.
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [tearingDown, setTearingDown] = useState(false);
  const [tdResult, setTdResult] = useState<TeardownResult | null>(null);
  const [tdError, setTdError] = useState<string | null>(null);
  // Mailboxes that teardown will destroy — fetched live so the admin sees every
  // address (across ALL domains, e.g. imported ones), not just the provisioned
  // domain named in the confirm prompt. Loaded lazily when the zone is expanded.
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [mbLoading, setMbLoading] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  // Provisioned domains whose SES identity + DNS teardown will remove (may be
  // more than the "primary" one — e.g. a second domain set up on this backend).
  const [provDomains, setProvDomains] = useState<string[] | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setInv(await load(stackName));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackName]);

  // Lazily load the mailbox list the first time the danger zone is opened (only
  // if a backend is actually deployed). Keeps the Cognito call off the common path.
  useEffect(() => {
    if (!dangerOpen || !inv?.stackExists || mailboxes !== null || mbLoading) return;
    let cancelled = false;
    (async () => {
      setMbLoading(true);
      setMbError(null);
      // Mailboxes and provisioned domains, in parallel — neither blocks the confirm UI.
      const [mb, dom] = await Promise.allSettled([listMailboxes(stackName), listDomains(stackName)]);
      if (cancelled) return;
      if (mb.status === "fulfilled") setMailboxes(mb.value.mailboxes);
      else setMbError(mb.reason instanceof Error ? mb.reason.message : String(mb.reason));
      if (dom.status === "fulfilled") setProvDomains(dom.value.domains);
      setMbLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dangerOpen, inv?.stackExists, stackName]);

  const grouped = inv ? groupByService(inv.resources) : [];
  const ledger = inv ? [...inv.ledger].sort((a, b) => (a.ts < b.ts ? 1 : -1)) : [];

  // The domain to tear down: the SES identity Mailpoppy created (its ledger name
  // is exactly the domain). If we can't infer it (e.g. a fresh machine), the user
  // types it freely below.
  const knownDomain = inv?.ledger.find((e) => e.service === "SES" && e.resourceType === "EmailIdentity")?.name;
  const somethingDeployed = !!inv && (inv.stackExists || ledger.length > 0);
  const typed = confirmText.trim().toLowerCase();
  const canTearDown =
    !tearingDown && typed.length > 0 && (knownDomain ? typed === knownDomain.toLowerCase() : /\./.test(typed));

  async function onTeardown() {
    setTdError(null);
    setTdResult(null);
    setTearingDown(true);
    try {
      const res = await teardown({ domain: typed, stackName });
      setTdResult(res);
      setConfirmText("");
      await refresh();
    } catch (e) {
      setTdError(e instanceof Error ? e.message : String(e));
    } finally {
      setTearingDown(false);
    }
  }

  // Danger zone — pinned near the top, collapsed by default (see state comment).
  const dangerZone = somethingDeployed ? (
    <div className="overflow-hidden rounded-xl border border-error/20 bg-[#1a0f14]">
      <button
        type="button"
        aria-label="Toggle danger zone"
        aria-expanded={dangerOpen}
        onClick={() => setDangerOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 p-6 text-left"
      >
        <div>
          <div className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-error">
            <AlertTriangle className="size-4" />
            Danger zone
          </div>
          <h3 className="text-lg font-semibold text-on-surface">Remove everything</h3>
          {!dangerOpen && (
            <p className="mt-1 text-sm text-on-surface-variant">
              Permanently delete the entire backend{knownDomain ? <> for <code className="font-mono text-tertiary">{knownDomain}</code></> : null} —
              stack, all stored mail &amp; mailboxes, the SES identity and DNS.
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-error/20 bg-error/5 px-3 py-1.5 text-sm font-medium text-error">
          {dangerOpen ? <>Hide <ChevronUp className="size-4" /></> : <>Show <ChevronDown className="size-4" /></>}
        </span>
      </button>

      {dangerOpen && (
        <div className="border-t border-error/10 p-6 pt-5">
          <p className="text-sm text-on-surface-variant">
            Permanently delete the <b className="text-on-surface">entire backend</b>: the CloudFormation stack,{" "}
            <b className="text-on-surface">all stored mail and mailboxes</b> (S3, DynamoDB, Cognito), the deploy bucket, and
            the SES identity + DNS records (MX/DKIM/DMARC/SPF) for{" "}
            {provDomains && provDomains.length > 0 ? (
              <b className="text-on-surface">
                every provisioned domain:{" "}
                {provDomains.map((d, i) => (
                  <span key={d}>
                    {i > 0 ? ", " : ""}
                    <code className="font-mono text-tertiary">{d}</code>
                  </span>
                ))}
              </b>
            ) : knownDomain ? (
              <code className="font-mono text-tertiary">{knownDomain}</code>
            ) : (
              "every provisioned domain"
            )}
            . <b className="text-tertiary">This cannot be undone.</b>
          </p>

          {/* The mailboxes that will be destroyed — across EVERY domain, not just
              the one named in the confirm prompt. */}
          <div className="mt-3 text-sm text-on-surface-variant">
            {mbLoading ? (
              "Checking which mailboxes will be deleted…"
            ) : mbError ? (
              <span className="text-amber-300">Couldn’t list mailboxes ({mbError}) — they will still be deleted.</span>
            ) : mailboxes && mailboxes.length > 0 ? (
              <>
                <b className="text-on-surface">
                  This deletes all {mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"} and their mail — across
                  every domain{knownDomain ? <>, not just <code className="font-mono text-tertiary">{knownDomain}</code></> : null}:
                </b>
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {mailboxes.map((m) => (
                    <li key={m.email}>{m.email}</li>
                  ))}
                </ul>
              </>
            ) : mailboxes && mailboxes.length === 0 ? (
              "No mailboxes remain in this backend."
            ) : null}
          </div>

          {tdResult ? (
            <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/10 p-4">
              <strong className="text-secondary">Removed {tdResult.deleted.length} item(s).</strong>
              <ul className="mt-1.5 list-disc pl-5 font-mono text-xs text-on-surface-variant">
                {tdResult.deleted.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              {tdResult.warnings.length > 0 && (
                <div className="mt-2 text-sm text-amber-300">
                  <b>Warnings:</b>
                  <ul className="mt-1 list-disc pl-5">
                    {tdResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : tearingDown ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant">
              <Spinner /> Removing everything… this can take a few minutes (waiting for CloudFormation to delete the
              stack). Please keep the app open.
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm text-on-surface-variant">
                <span className="mb-1 block">
                  Type {knownDomain ? <code className="font-mono text-tertiary">{knownDomain}</code> : "the domain name"} to confirm
                </span>
                <input
                  aria-label="Type domain to confirm teardown"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={knownDomain ?? "yourdomain.com"}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-64 rounded-lg border border-error/30 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-on-surface placeholder:text-outline-variant focus:border-error focus:outline-none focus:ring-2 focus:ring-error/30"
                />
              </label>
              <Button variant="danger" disabled={!canTearDown} onClick={() => void onTeardown()}>
                Remove everything
              </Button>
            </div>
          )}

          {tdError && <div className="mt-3 text-sm text-tertiary">Teardown failed: {tdError}</div>}
        </div>
      )}
    </div>
  ) : null;

  return (
    <section className="flex flex-col gap-6">
      {/* Overview (Stitch layout): summary + stat tiles fill the left; the danger
          zone sits in a compact right column to free up vertical space up top. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Card className={dangerZone ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-on-surface">
                <Sparkles className="size-5 text-primary" />
                What Mailpoppy did to your account
              </h2>
              <p className="mt-1 max-w-2xl text-on-surface-variant">
                Everything Mailpoppy created in your own AWS account — read live from CloudFormation, plus a local log of
                DNS/SES changes. Verify any of it in your console.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
          </div>

          {/* Provisioning summary stats (real counts from the live inventory + ledger). */}
          {inv && inv.stackExists && (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Stack resources" value={inv.resources.length} />
              <StatTile label="AWS services" value={grouped.length} />
              <StatTile label="DNS / SES changes" value={ledger.length} />
              <StatTile label="Region" value={<span className="font-mono text-lg">{inv.region}</span>} />
            </div>
          )}
        </Card>

        {/* Right column — danger zone (pinned at the top, collapsed by default). */}
        {dangerZone && <div className="lg:col-span-1">{dangerZone}</div>}
      </div>

      {error && (
        <Card className="border-tertiary/30 bg-tertiary-container/10">
          <div className="text-tertiary">Couldn’t read your account: {error}</div>
          <div className="mt-1.5 text-sm text-on-surface-variant">
            Make sure the provisioning helper is running and your AWS credentials are set.
          </div>
        </Card>
      )}

      {inv && !inv.stackExists && (
        <Card className="bg-surface-container/60">
          <strong className="text-on-surface">No Mailpoppy backend is deployed</strong> in{" "}
          <code className="font-mono text-sm text-on-surface-variant">{inv.region}</code> (stack{" "}
          <code className="font-mono text-sm text-on-surface-variant">{inv.stackName}</code> not found). Nothing is running
          in your account from the backend stack.
          {ledger.length === 0 && " The change log below is empty too."}
        </Card>
      )}

      {inv && inv.stackExists && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-outline-variant/10 bg-surface-container-low/50 p-5">
            <strong className="text-on-surface">Deployed stack: {inv.stackName}</strong>
            <span className="font-mono text-xs text-on-surface-variant">
              {inv.resources.length} resources · {inv.region}
            </span>
          </div>
          <div className="p-5">
            {grouped.map((g) => (
              <div key={g.service} className="mt-5 first:mt-0">
                <div className="mb-2 text-sm font-semibold text-on-surface">
                  {g.service} <span className="font-normal text-on-surface-variant">({g.items.length})</span>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th>Console</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r) => {
                      const url = awsConsoleUrl(r.type, r.physicalId, inv.region);
                      return (
                        <tr key={r.logicalId} className="transition-colors hover:bg-white/[0.02]">
                          <Td className="break-all font-mono text-xs text-on-surface">{r.physicalId || r.logicalId}</Td>
                          <Td className="text-xs text-on-surface-variant">{r.type}</Td>
                          <Td className="text-xs text-on-surface-variant">{r.status}</Td>
                          <Td>
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer" className={consoleLink}>
                                Open <ExternalLink className="size-3" />
                              </a>
                            ) : (
                              <span className="text-on-surface-variant/50">—</span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Out-of-stack change log (created/deleted) */}
      <Card className="p-0">
        <div className="border-b border-outline-variant/10 bg-surface-container-low/50 p-5">
          <strong className="text-on-surface">Change log</strong>
          <span className="ml-2 text-sm text-on-surface-variant">DNS / SES — outside the stack</span>
        </div>
        {ledger.length === 0 ? (
          <p className="p-5 text-sm text-on-surface-variant">No direct DNS/SES changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-container-low">
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Service</Th>
                  <Th>Resource</Th>
                  <Th>Name</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e, i) => {
                  const url = ledgerConsoleUrl(e);
                  const deleted = e.action === "deleted";
                  return (
                    <tr key={`${e.ts}-${i}`} className="transition-colors hover:bg-white/[0.02]">
                      <Td className={cn("whitespace-nowrap text-xs text-on-surface-variant", deleted && "line-through opacity-60")}>
                        {new Date(e.ts).toLocaleString()}
                      </Td>
                      <Td>
                        <ActionChip action={e.action} />
                      </Td>
                      <Td className={cn("text-xs", deleted ? "text-on-surface-variant/60" : "text-on-surface")}>{e.service}</Td>
                      <Td className="text-xs text-on-surface-variant">{e.resourceType}</Td>
                      <Td className="font-mono text-xs">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className={consoleLink}>
                            {e.name} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className={deleted ? "text-on-surface-variant/60 line-through" : "text-on-surface"}>{e.name}</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
