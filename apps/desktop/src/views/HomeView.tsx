import { useEffect, useState, type ReactNode } from "react";
import { Globe, Mail, ShieldCheck, Inbox, RefreshCw, Plus, Server, Sparkles, MapPin } from "lucide-react";
import type { SesAccountStatus, MailFromState } from "@mailpoppy/core";
import { resolveStackName, loadDeploymentConfig } from "../lib/deploymentConfig";
import { listProvisionedDomains as defaultListDomains } from "../lib/teardown";
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
  listDomains = defaultListDomains,
  listMailboxes = defaultListMailboxes,
  getAccount = defaultGetAccount,
  getDomainStatus = defaultGetDomainStatus,
  getMailFrom = defaultGetMailFrom,
}: {
  stackName?: string;
  onGoToSetup?: () => void;
  listDomains?: (stackName: string) => Promise<{ domains: string[] }>;
  listMailboxes?: (stackName: string) => Promise<{ mailboxes: Mailbox[]; region?: string }>;
  getAccount?: () => Promise<SesAccountStatus>;
  getDomainStatus?: (domain: string) => Promise<DomainIdentityStatus>;
  getMailFrom?: (domain: string) => Promise<MailFromState>;
}) {
  type Phase = "loading" | "no-backend" | "ready" | "error";
  const [phase, setPhase] = useState<Phase>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
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
        setErrMsg(String(mbRes.reason));
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
            <ShieldCheck className="size-4" /> Backend <Pill tone="ok">Deployed</Pill>
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
        <Card className="text-center">
          <Globe className="mx-auto size-6 text-on-surface-variant" />
          <p className="mt-2 text-sm text-on-surface-variant">
            No domains yet. Use <b className="text-on-surface">Add domain</b> to set one up.
          </p>
        </Card>
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

                {onGoToSetup && (
                  <div className="mt-auto">
                    <button
                      onClick={onGoToSetup}
                      className="text-sm text-primary underline-offset-2 hover:underline"
                    >
                      Manage in Setup →
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
