import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Globe, Inbox, Mail, Plus, RefreshCw, Server, ArrowLeftRight } from "lucide-react";
import type { MailFromState } from "@mailpoppy/core";
import { resolveStackName, saveDeploymentConfig } from "../lib/deploymentConfig";
import {
  listMailboxes as defaultListMailboxes,
  createMailbox as defaultCreateMailbox,
  type Mailbox,
  type BackendInfo,
} from "../lib/mailbox";
import { getMailFromStatus as defaultGetMailFrom } from "../lib/mailFrom";
import { getDomainIdentityStatus as defaultGetDomainStatus, type DomainIdentityStatus } from "../lib/provision";
import { MailboxStorageRow } from "./MailboxStorageRow";
import { Card, Button, Spinner, cn } from "../ui";

// Domain workspace — the per-domain drill-in reached from a Home card. A
// Mailpoppy admin runs several domains on ONE shared backend, so this view
// scopes everything genuinely per-domain: its SES/DKIM/MAIL FROM health, the
// mailboxes on this domain, adding a mailbox, opening its inbox, and importing
// old mail into it. Account-wide concerns (region, deploy, mail rules, the AWS
// inventory + teardown) stay out of here — they live in Setup / AWS Resources.

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

const inputCls =
  "rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";
const noAutoCap = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

export function DomainView({
  domain,
  stackName = resolveStackName(),
  onBack,
  onOpenInbox,
  onMigrateInto,
  listMailboxes = defaultListMailboxes,
  createMailbox = defaultCreateMailbox,
  getDomainStatus = defaultGetDomainStatus,
  getMailFrom = defaultGetMailFrom,
}: {
  domain: string;
  stackName?: string;
  onBack?: () => void;
  onOpenInbox?: () => void;
  onMigrateInto?: (domain: string) => void;
  listMailboxes?: (stackName: string) => Promise<BackendInfo & { ok: true; mailboxes: Mailbox[] }>;
  createMailbox?: (input: { email: string; password: string; stackName?: string }) => Promise<
    BackendInfo & { ok: true; mailbox: Mailbox }
  >;
  getDomainStatus?: (domain: string) => Promise<DomainIdentityStatus>;
  getMailFrom?: (domain: string) => Promise<MailFromState>;
}) {
  type Phase = "loading" | "no-backend" | "ready" | "error";
  const [phase, setPhase] = useState<Phase>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [backend, setBackend] = useState<BackendInfo | null>(null);
  const [domStatus, setDomStatus] = useState<DomainIdentityStatus | "error" | null>(null);
  const [mailFrom, setMailFrom] = useState<MailFromState | "error" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Add-mailbox form. The address is always on THIS domain, so we collect just
  // the local part and append "@domain".
  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [mbBusy, setMbBusy] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  const [mbCreated, setMbCreated] = useState<string | null>(null);

  async function reload() {
    const res = await listMailboxes(stackName);
    setMailboxes(res.mailboxes);
    setBackend({ region: res.region, userPoolId: res.userPoolId, clientId: res.clientId, apiBaseUrl: res.apiBaseUrl });
  }

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setErrMsg(null);
    setDomStatus(null);
    setMailFrom(null);
    (async () => {
      try {
        await reload();
        if (cancelled) return;
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        if (isNoBackend(e)) setPhase("no-backend");
        else {
          setErrMsg(String(e));
          setPhase("error");
        }
        return;
      }
      // Health badges, best-effort and independent.
      getDomainStatus(domain)
        .then((s) => !cancelled && setDomStatus(s))
        .catch(() => !cancelled && setDomStatus("error"));
      getMailFrom(domain)
        .then((s) => !cancelled && setMailFrom(s))
        .catch(() => !cancelled && setMailFrom("error"));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, stackName, reloadKey]);

  const onDomain = mailboxes.filter((m) => domainOf(m.email) === domain.toLowerCase());

  async function createMb() {
    const local = localPart.trim().toLowerCase();
    if (!local || !password) return;
    const email = `${local}@${domain}`;
    setMbBusy(true);
    setMbError(null);
    setMbCreated(null);
    try {
      const res = await createMailbox({ email, password, stackName });
      setMbCreated(res.mailbox.email);
      setLocalPart("");
      setPassword("");
      // Persist the backend config so the Inbox tab can sign in immediately.
      if (res.apiBaseUrl && res.userPoolId && res.clientId) {
        saveDeploymentConfig({
          apiBaseUrl: res.apiBaseUrl,
          userPoolId: res.userPoolId,
          clientId: res.clientId,
          region: res.region,
          stackName,
        });
      }
      await reload();
    } catch (e) {
      setMbError(String(e));
    } finally {
      setMbBusy(false);
    }
  }

  // ---- Header (always shown so the user can navigate back) ----
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back to overview"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <Globe className="size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-wider text-primary">Domain</div>
          <h2 className="truncate text-2xl font-bold tracking-tight text-on-surface">{domain}</h2>
        </div>
      </div>
      <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
        <RefreshCw className="size-4" /> Refresh
      </Button>
    </div>
  );

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Spinner /> Loading {domain}…
        </div>
      </div>
    );
  }

  if (phase === "no-backend") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <div className="flex items-center gap-2 text-on-surface">
            <Server className="size-4 text-primary" />
            <span>No backend is deployed yet.</span>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">
            Deploy your backend and set up this domain from the <b className="text-on-surface">Setup</b> tab first — then
            its mailboxes and health will show up here.
          </p>
        </Card>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <h3 className="text-lg font-semibold text-on-surface">Couldn't load {domain}</h3>
          <p className="mt-2 text-sm text-tertiary">{errMsg}</p>
          <Button variant="secondary" className="mt-4" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </Card>
      </div>
    );
  }

  // ---- Ready ----
  return (
    <div className="flex flex-col gap-6">
      {header}

      {/* Domain health badges. */}
      <Card>
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <h3 className="font-semibold text-on-surface">Domain health</h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {domStatus === null ? (
            <Pill tone="muted">DKIM …</Pill>
          ) : domStatus === "error" ? (
            <Pill tone="muted">DKIM unknown</Pill>
          ) : domStatus.dkim === "SUCCESS" ? (
            <Pill tone="ok">DKIM verified</Pill>
          ) : (
            <Pill tone="warn">DKIM {domStatus.dkim.toLowerCase()}</Pill>
          )}

          {domStatus && domStatus !== "error" && (
            <Pill tone={domStatus.verifiedForSending ? "ok" : "warn"}>
              {domStatus.verifiedForSending ? "Can send" : "Not sending yet"}
            </Pill>
          )}

          {mailFrom === null ? (
            <Pill tone="muted">MAIL FROM …</Pill>
          ) : mailFrom === "error" ? (
            <Pill tone="muted">MAIL FROM unknown</Pill>
          ) : (mailFrom.status ?? "").toLowerCase() === "success" ? (
            <Pill tone="ok">MAIL FROM aligned</Pill>
          ) : mailFrom.mailFromDomain ? (
            <Pill tone="warn">MAIL FROM pending</Pill>
          ) : (
            <Pill tone="muted">MAIL FROM not set</Pill>
          )}
        </div>
        {domStatus && domStatus !== "error" && !domStatus.verifiedForSending && (
          <p className="mt-3 text-xs text-on-surface-variant/80">
            DNS for this domain isn't fully verified yet. Finish or re-check it in{" "}
            <b className="text-on-surface">Setup</b>.
          </p>
        )}
      </Card>

      {/* Mailboxes on this domain. */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Inbox className="size-4 text-primary" />
            <h3 className="font-semibold text-on-surface">
              Mailboxes <span className="font-normal text-on-surface-variant">({onDomain.length})</span>
            </h3>
          </div>
          <div className="flex gap-2">
            {onOpenInbox && (
              <Button variant="secondary" size="sm" onClick={onOpenInbox}>
                <Inbox className="size-4" /> Open inbox
              </Button>
            )}
            {onMigrateInto && (
              <Button variant="secondary" size="sm" onClick={() => onMigrateInto(domain)}>
                <ArrowLeftRight className="size-4" /> Import old mail
              </Button>
            )}
          </div>
        </div>

        {/* Add a mailbox on this domain. */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
            New mailbox
            <span className="flex items-stretch">
              <input
                aria-label={`New mailbox name on ${domain}`}
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value.trim().toLowerCase())}
                placeholder="you"
                className={cn(inputCls, "w-40 rounded-r-none")}
                {...noAutoCap}
              />
              <span className="flex items-center rounded-r-lg border border-l-0 border-outline-variant/30 bg-surface-container-highest/40 px-3 font-mono text-sm text-on-surface-variant">
                @{domain}
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
            Password
            <input
              aria-label="New mailbox password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(inputCls, "w-56")}
            />
          </label>
          <Button onClick={() => void createMb()} disabled={mbBusy || !localPart || !password}>
            {mbBusy ? <Spinner className="border-white/40 border-t-white" /> : <Plus className="size-4" />}
            {mbBusy ? "Creating…" : "Create mailbox"}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-on-surface-variant/70">
          Password must meet the pool policy (min 8 chars, with upper &amp; lower case, a number and a symbol).
        </p>

        {mbCreated && (
          <div className="mt-3 rounded-lg border border-secondary/30 bg-secondary/10 p-3 text-sm text-on-surface">
            ✅ Mailbox <b>{mbCreated}</b> created. Open the <b>Inbox</b> tab and sign in as{" "}
            <code className="font-mono text-xs">{mbCreated}</code>.
          </div>
        )}
        {mbError && (
          <div className="mt-3 rounded-lg border border-tertiary/30 bg-tertiary-container/10 p-3 text-sm text-tertiary">
            {mbError}
          </div>
        )}

        <div className="mt-4">
          {onDomain.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No mailboxes on this domain yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {onDomain.map((m) => (
                <MailboxStorageRow
                  key={m.email}
                  email={m.email}
                  status={m.status}
                  stackName={stackName}
                  onDeleted={() => setReloadKey((k) => k + 1)}
                />
              ))}
            </ul>
          )}
          {backend && (
            <p className="mt-3 font-mono text-xs text-on-surface-variant/70">
              backend {stackName} · pool {backend.userPoolId} · {backend.region}
            </p>
          )}
        </div>
      </Card>

      {/* Import old mail into this domain. */}
      {onMigrateInto && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-primary" />
              <div>
                <h3 className="font-semibold text-on-surface">Import old mail</h3>
                <p className="mt-0.5 text-sm text-on-surface-variant">
                  Bring mail across from another IMAP mailbox into a mailbox on {domain}.
                </p>
              </div>
            </div>
            <Button variant="secondary" onClick={() => onMigrateInto(domain)}>
              <ArrowLeftRight className="size-4" /> Open migration
            </Button>
          </div>
        </Card>
      )}

      <p className="text-xs text-on-surface-variant/70">
        To remove this domain's DNS/SES or tear down the whole backend, use the{" "}
        <b className="text-on-surface">AWS Resources</b> tab.
      </p>
    </div>
  );
}
