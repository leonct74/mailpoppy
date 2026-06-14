import { useEffect, useState, type ReactNode } from "react";
import {
  Globe,
  Mail,
  ShieldCheck,
  Inbox,
  RefreshCw,
  Plus,
  Server,
  Sparkles,
  MapPin,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import type { SesAccountStatus, MailFromState } from "@mailpoppy/core";
import { resolveStackName, loadDeploymentConfig } from "../lib/deploymentConfig";
import {
  listProvisionedDomains as defaultListDomains,
  teardownEverything as defaultTeardown,
  type TeardownResult,
} from "../lib/teardown";
import { friendlyError } from "../lib/errors";
import { listMailboxes as defaultListMailboxes, type Mailbox } from "../lib/mailbox";
import { getSesAccount as defaultGetAccount } from "../lib/sesAccount";
import { getMailFromStatus as defaultGetMailFrom } from "../lib/mailFrom";
import { getDomainIdentityStatus as defaultGetDomainStatus, type DomainIdentityStatus } from "../lib/provision";
import { Card, Button, Spinner, cn } from "../ui";

// Home — a multi-domain overview. A Mailpoppy admin typically runs several
// domains, each with several mailboxes, so this is the at-a-glance control
// surface: account posture (region + SES sending) up top, then one card per
// domain with its health badges and mailbox count. Read-only in this phase —
// the "Manage" / "Add domain" actions hand off to the Setup tab.

type Tone = "ok" | "warn" | "muted" | "bad";
const TONE: Record<Tone, string> = {
  ok: "border-secondary/20 bg-secondary/10 text-secondary",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  muted: "border-outline-variant/20 bg-surface-container-highest/40 text-on-surface-variant",
  bad: "border-tertiary/30 bg-tertiary-container/15 text-tertiary",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px]", TONE[tone])}>
      {children}
    </span>
  );
}

const isNoBackend = (e: unknown) => {
  const m = String(e);
  return /\b404\b/.test(m) && /No deployed Mailpoppy backend/i.test(m);
};

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

export function HomeView({
  stackName = resolveStackName(),
  onGoToSetup,
  onOpenDomain,
  listDomains = defaultListDomains,
  listMailboxes = defaultListMailboxes,
  getAccount = defaultGetAccount,
  getDomainStatus = defaultGetDomainStatus,
  getMailFrom = defaultGetMailFrom,
  teardown = defaultTeardown,
}: {
  stackName?: string;
  onGoToSetup?: () => void;
  onOpenDomain?: (domain: string) => void;
  listDomains?: (stackName: string) => Promise<{ domains: string[] }>;
  listMailboxes?: (stackName: string) => Promise<{ mailboxes: Mailbox[]; region?: string }>;
  getAccount?: () => Promise<SesAccountStatus>;
  getDomainStatus?: (domain: string) => Promise<DomainIdentityStatus>;
  getMailFrom?: (domain: string) => Promise<MailFromState>;
  teardown?: (input: { domain?: string; stackName?: string; deleteDeployBucket?: boolean }) => Promise<TeardownResult>;
}) {
  type Phase = "loading" | "no-backend" | "ready" | "error";
  const [phase, setPhase] = useState<Phase>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  // Positive proof a backend stack actually exists: the mailbox endpoint resolved
  // the stack's Cognito pool. The teardown-discover endpoint can't tell us (it
  // returns [] whether the stack is absent or just empty), so we must NOT infer
  // "backend present" from an empty domain list. Gates the destructive teardown.
  const [backendDeployed, setBackendDeployed] = useState(false);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [account, setAccount] = useState<SesAccountStatus | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [domStatus, setDomStatus] = useState<Record<string, DomainIdentityStatus | "error">>({});
  const [mailFrom, setMailFrom] = useState<Record<string, MailFromState | "error">>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrMsg(null);
    setBackendDeployed(false);
    setDomStatus({});
    setMailFrom({});
    (async () => {
      const [mbRes, domRes, acctRes] = await Promise.allSettled([
        listMailboxes(stackName),
        listDomains(stackName),
        getAccount(),
      ]);
      if (cancelled) return;

      const mbNoBackend = mbRes.status === "rejected" && isNoBackend(mbRes.reason);
      const domNoBackend = domRes.status === "rejected" && isNoBackend(domRes.reason);
      if (mbNoBackend || domNoBackend) {
        setPhase("no-backend");
        return;
      }
      if (mbRes.status === "rejected" && domRes.status === "rejected") {
        setErrMsg(friendlyError(mbRes.reason));
        setPhase("error");
        return;
      }

      const mbs = mbRes.status === "fulfilled" ? mbRes.value.mailboxes : [];
      const provisioned = domRes.status === "fulfilled" ? domRes.value.domains : [];
      // Show every domain we know about: provisioned identities + any domain that
      // appears in a mailbox address (e.g. one only used as an import target).
      const all = new Set<string>(provisioned.map((d) => d.toLowerCase()));
      for (const mb of mbs) {
        const d = domainOf(mb.email);
        if (d) all.add(d);
      }
      const domainList = [...all].sort();

      setMailboxes(mbs);
      setDomains(domainList);
      // Only the mailbox endpoint resolving the stack's pool proves a backend
      // exists — this gates the "remove leftover infrastructure" teardown.
      setBackendDeployed(mbRes.status === "fulfilled");
      setAccount(acctRes.status === "fulfilled" ? acctRes.value : null);
      setRegion(
        (mbRes.status === "fulfilled" ? mbRes.value.region : undefined) ?? loadDeploymentConfig()?.region ?? null,
      );
      setPhase("ready");

      // Per-domain badges, best-effort and independent so one slow/failed domain
      // doesn't block the rest.
      for (const d of domainList) {
        getDomainStatus(d)
          .then((s) => !cancelled && setDomStatus((m) => ({ ...m, [d]: s })))
          .catch(() => !cancelled && setDomStatus((m) => ({ ...m, [d]: "error" })));
        getMailFrom(d)
          .then((s) => !cancelled && setMailFrom((m) => ({ ...m, [d]: s })))
          .catch(() => !cancelled && setMailFrom((m) => ({ ...m, [d]: "error" })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stackName, reloadKey, listMailboxes, listDomains, getAccount, getDomainStatus, getMailFrom]);

  // ---- Loading ----
  if (phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Spinner /> Loading your domains and mailboxes…
      </div>
    );
  }

  // ---- No backend yet → onboarding hand-off ----
  if (phase === "no-backend") {
    return (
      <Card className="mx-auto max-w-2xl text-center">
        <Sparkles className="mx-auto size-8 text-primary" />
        <h2 className="mt-3 text-xl font-semibold text-on-surface">Welcome to Mailpoppy</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-on-surface-variant">
          You don't have any email infrastructure yet. Head to <b className="text-on-surface">Setup</b> to deploy your
          backend and add your first domain — your domains and mailboxes will then show up here.
        </p>
        {onGoToSetup && (
          <Button className="mx-auto mt-5" onClick={onGoToSetup}>
            <Plus className="size-4" /> Set up your first domain
          </Button>
        )}
      </Card>
    );
  }

  // ---- Error ----
  if (phase === "error") {
    return (
      <Card className="mx-auto max-w-2xl">
        <h2 className="text-lg font-semibold text-on-surface">Couldn't load your overview</h2>
        <p className="mt-2 text-sm text-tertiary">{errMsg}</p>
        <p className="mt-2 text-sm text-on-surface-variant">
          This usually means your AWS credentials need attention — the <b className="text-on-surface">Setup</b> tab
          checks them in detail.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="size-4" /> Retry
          </Button>
          {onGoToSetup && (
            <Button variant="secondary" onClick={onGoToSetup}>
              Open Setup
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // ---- Ready ----
  const sending = account
    ? account.productionAccessEnabled
      ? ({ tone: "ok", label: "Production access" } as const)
      : ({ tone: "warn", label: "Sandbox" } as const)
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Intro + add-domain */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-xs uppercase tracking-wider text-primary">Overview</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-on-surface">Your domains &amp; mailboxes</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          {onGoToSetup && (
            <Button onClick={onGoToSetup}>
              <Plus className="size-4" /> Add domain
            </Button>
          )}
        </div>
      </div>

      {/* Account-level posture (one backend per install). */}
      <Card>
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <h3 className="font-semibold text-on-surface">Account</h3>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <span className="flex items-center gap-1.5 text-on-surface-variant">
            <MapPin className="size-4" /> Region{" "}
            <code className="font-mono text-on-surface">{region ?? "—"}</code>
          </span>
          <span className="flex items-center gap-1.5 text-on-surface-variant">
            <ShieldCheck className="size-4" /> Backend{" "}
            {backendDeployed ? <Pill tone="ok">Deployed</Pill> : <Pill tone="muted">unavailable</Pill>}
          </span>
          <span className="flex items-center gap-1.5 text-on-surface-variant">
            <Mail className="size-4" /> Sending{" "}
            {sending ? (
              <Pill tone={sending.tone}>{sending.label}</Pill>
            ) : (
              <Pill tone="muted">unavailable</Pill>
            )}
            {account && !account.sendingEnabled && <Pill tone="bad">paused</Pill>}
          </span>
          {account?.sendQuota && (
            <span className="text-on-surface-variant">
              <code className="font-mono text-on-surface">
                {Math.round(account.sendQuota.sentLast24Hours)}/{Math.round(account.sendQuota.max24Hour)}
              </code>{" "}
              sent (24h)
            </span>
          )}
        </div>
        {account && !account.productionAccessEnabled && (
          <p className="mt-3 text-xs text-on-surface-variant/80">
            You're in the SES sandbox — you can only send to verified addresses. Request production access from{" "}
            <b className="text-on-surface">Setup → Sending access</b>.
          </p>
        )}
      </Card>

      {/* Per-domain cards. */}
      {domains.length === 0 ? (
        <div className="flex flex-col gap-4">
          <Card className="text-center">
            <Globe className="mx-auto size-6 text-on-surface-variant" />
            <p className="mt-2 text-sm text-on-surface-variant">
              No domains yet. Use <b className="text-on-surface">Add domain</b> to set one up.
            </p>
          </Card>
          {/* Backend deployed but zero domains — the one state where a full teardown
              is safe to offer (no mailboxes or domains left to lose). Gated on a
              CONFIRMED backend so a new account (no stack) never sees a destructive
              button, and so the orphaned stack doesn't linger when one does exist. */}
          {backendDeployed && (
            <LeftoverInfrastructureCard
              stackName={stackName}
              region={region}
              teardown={teardown}
              onDone={() => setReloadKey((k) => k + 1)}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {domains.map((d) => {
            const count = mailboxes.filter((m) => domainOf(m.email) === d).length;
            const ds = domStatus[d];
            const mf = mailFrom[d];
            return (
              <Card key={d} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Globe className="size-4 shrink-0 text-primary" />
                    <h3 className="truncate font-mono text-sm font-semibold text-on-surface">{d}</h3>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-on-surface-variant">
                    <Inbox className="size-3.5" /> {count} mailbox{count === 1 ? "" : "es"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* DKIM */}
                  {ds === undefined ? (
                    <Pill tone="muted">DKIM …</Pill>
                  ) : ds === "error" ? (
                    <Pill tone="muted">DKIM unknown</Pill>
                  ) : ds.dkim === "SUCCESS" ? (
                    <Pill tone="ok">DKIM verified</Pill>
                  ) : (
                    <Pill tone="warn">DKIM {ds.dkim.toLowerCase()}</Pill>
                  )}

                  {/* Can send from this domain */}
                  {ds && ds !== "error" && (
                    <Pill tone={ds.verifiedForSending ? "ok" : "warn"}>
                      {ds.verifiedForSending ? "Can send" : "Not sending yet"}
                    </Pill>
                  )}

                  {/* MAIL FROM alignment */}
                  {mf === undefined ? (
                    <Pill tone="muted">MAIL FROM …</Pill>
                  ) : mf === "error" ? (
                    <Pill tone="muted">MAIL FROM unknown</Pill>
                  ) : (mf.status ?? "").toLowerCase() === "success" ? (
                    <Pill tone="ok">MAIL FROM aligned</Pill>
                  ) : mf.mailFromDomain ? (
                    <Pill tone="warn">MAIL FROM pending</Pill>
                  ) : (
                    <Pill tone="muted">MAIL FROM not set</Pill>
                  )}
                </div>

                {(onOpenDomain || onGoToSetup) && (
                  <div className="mt-auto">
                    <button
                      onClick={() => (onOpenDomain ? onOpenDomain(d) : onGoToSetup?.())}
                      aria-label={`Manage ${d}`}
                      className="text-sm text-primary underline-offset-2 hover:underline"
                    >
                      {onOpenDomain ? "Manage →" : "Manage in Setup →"}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Shown only on the overview when a backend stack is deployed but NO domains
// remain — the single state where tearing down the whole backend is safe (there
// are no mailboxes or domains left to lose). Deletes the leftover AWS resources
// the stack created so they don't linger (and bill) in the user's account.
function LeftoverInfrastructureCard({
  stackName,
  region,
  teardown,
  onDone,
}: {
  stackName: string;
  region: string | null;
  teardown: (input: { domain?: string; stackName?: string; deleteDeployBucket?: boolean }) => Promise<TeardownResult>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TeardownResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canRemove = confirm.trim().toUpperCase() === "DELETE" && !busy;

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setResult(await teardown({ stackName }));
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-error/20 bg-[#1a0f14]">
      <button
        type="button"
        aria-label="Toggle danger zone"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 p-6 text-left"
      >
        <div>
          <div className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-error">
            <AlertTriangle className="size-4" />
            Danger zone
          </div>
          <h3 className="text-lg font-semibold text-on-surface">Remove leftover infrastructure</h3>
          {!open && (
            <p className="mt-1 text-sm text-on-surface-variant">
              No domains remain, but the Mailpoppy backend is still deployed in your AWS account. Delete the leftover
              resources so they don't linger.
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-error/20 bg-error/5 px-3 py-1.5 text-sm font-medium text-error">
          {open ? (
            <>
              Hide <ChevronUp className="size-4" />
            </>
          ) : (
            <>
              Show <ChevronDown className="size-4" />
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-error/10 p-6 pt-5">
          <p className="text-sm text-on-surface-variant">
            You have no domains, but the Mailpoppy backend (stack{" "}
            <code className="font-mono text-tertiary">{stackName}</code>
            {region ? (
              <>
                {" "}
                in <code className="font-mono text-tertiary">{region}</code>
              </>
            ) : null}
            ) is still deployed. This permanently deletes the leftover AWS resources: the{" "}
            <b className="text-on-surface">CloudFormation stack</b>, the{" "}
            <b className="text-on-surface">mail storage bucket</b>, DynamoDB tables, the{" "}
            <b className="text-on-surface">Cognito user pool</b> and the deploy bucket.{" "}
            <b className="text-tertiary">This cannot be undone.</b>
          </p>

          {result ? (
            <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/10 p-4">
              <strong className="text-secondary">Infrastructure removed.</strong>
              {result.deleted.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-xs text-on-surface-variant">
                  {result.deleted.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
              {result.warnings.length > 0 && (
                <div className="mt-2 text-sm text-amber-300">
                  <b>Warnings:</b>
                  <ul className="mt-1 list-disc pl-5">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button variant="secondary" className="mt-3" onClick={onDone}>
                <RefreshCw className="size-4" /> Done
              </Button>
            </div>
          ) : busy ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant">
              <Spinner /> Removing infrastructure… this can take a few minutes.
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm text-on-surface-variant">
                <span className="mb-1 block">
                  Type <code className="font-mono text-tertiary">DELETE</code> to confirm
                </span>
                <input
                  aria-label="Type DELETE to confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="DELETE"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-64 rounded-lg border border-error/30 bg-surface-container-lowest px-3 py-2 font-mono text-sm text-on-surface placeholder:text-outline-variant focus:border-error focus:outline-none focus:ring-2 focus:ring-error/30"
                />
              </label>
              <Button variant="danger" disabled={!canRemove} onClick={() => void run()}>
                <Trash2 className="size-4" /> Remove infrastructure
              </Button>
            </div>
          )}

          {err && <div className="mt-3 text-sm text-tertiary">Removal failed: {err}</div>}
        </div>
      )}
    </div>
  );
}
