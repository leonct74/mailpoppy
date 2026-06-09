import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal, KeyRound, ShieldCheck, Rocket, Globe, RefreshCw, Mail, Sparkles } from "lucide-react";
import { sidecar } from "../lib/sidecar";
import { createMailbox, listMailboxes, type Mailbox, type BackendInfo } from "../lib/mailbox";
import { deployBackend, deployStatus, type DeployStatus } from "../lib/deploy";
import { saveDeploymentConfig, loadDeploymentConfig, resolveStackName, DEFAULT_STACK_NAME } from "../lib/deploymentConfig";
import { MailboxStorageRow } from "./MailboxStorageRow";
import { SendingAccessView } from "./SendingAccessView";
import { MailFromSetup } from "./MailFromSetup";
import { RegionPicker } from "./RegionPicker";
import { AdminPrivacyNotice } from "./AdminPrivacyNotice";
import { Card, Button, Spinner, cn } from "../ui";

// Phase 1 setup wizard.
// Step 0 verifies the AWS environment (credentials + per-service permissions, + detects
// the optional CLI) so provisioning never fails halfway. Then, once ready:
//   1. preflight → 2. provision → poll DKIM → 3. send deliverability test.
// A "Mailboxes" section manages Cognito users in the deployed backend.

interface Readiness {
  cli: { installed: boolean; version?: string };
  credentials: { ok: boolean; arn?: string; account?: string; error?: string };
  permissions: Record<"route53" | "ses" | "sesv2" | "s3", "ok" | "denied" | "error">;
  ready: boolean;
}
interface Preflight {
  accountId: string;
  zoneId: string;
  region: string;
}
interface ProvisionResult {
  ok: boolean;
  dkimTokens: string[];
}
interface IdentityStatus {
  verifiedForSending: boolean;
  dkim: string;
}

type Step =
  | "start"
  | "preflighted"
  | "deploying"
  | "deployed"
  | "provisioning"
  | "verifying"
  | "verified"
  | "sending"
  | "sent";
const SERVICES = ["route53", "ses", "sesv2", "s3"] as const;

const noAutoCap = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;

const inputCls =
  "rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";

/** Inline code chip. */
function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-container-lowest px-1 py-0.5 font-mono text-[0.85em] text-on-surface-variant">{children}</code>;
}

/** A numbered step card with the accent bar + "STEP" pill from the Stitch design. */
function StepCard({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container p-6 shadow-lg shadow-black/20">
      <span aria-hidden className="absolute left-0 top-0 h-full w-1 bg-primary-container" />
      <div className="mb-4 flex items-center gap-3">
        <span className="rounded-full border border-primary/30 bg-primary-container/20 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-primary">
          {step}
        </span>
        <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Mint "ok" pill used for verified dependencies. */
function OkBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 font-mono text-xs text-secondary">
      <ShieldCheck className="size-3.5" /> {children}
    </span>
  );
}

/** A warning callout (amber). */
function Warn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100", className)}>{children}</div>;
}

const permTone = (v: "ok" | "denied" | "error") =>
  v === "ok"
    ? "border-secondary/20 bg-secondary/10 text-secondary"
    : v === "denied"
      ? "border-tertiary/30 bg-tertiary-container/15 text-tertiary"
      : "border-amber-400/30 bg-amber-400/10 text-amber-300";
const permIcon = (v: "ok" | "denied" | "error") => (v === "ok" ? "✓" : v === "denied" ? "⛔" : "⚠");

export function SetupWizard() {
  // Step 0 — environment readiness
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(true);
  const retryRef = useRef<number | null>(null);

  // Steps 1–3
  const [domain, setDomain] = useState("");
  const [recipient, setRecipient] = useState("");
  const [step, setStep] = useState<Step>("start");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  // In-app confirmation. Tauri's webview (WKWebView on macOS) doesn't reliably
  // show the native window.confirm() dialog — it just returns false — so a
  // confirm-gated action would silently do nothing. We render our own dialog.
  const [confirmAction, setConfirmAction] = useState<null | { message: string; run: () => void }>(null);

  // Backend deploy (CloudFormation)
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [enableMalware, setEnableMalware] = useState(true); // recommended → default on
  const deployPollRef = useRef<number | null>(null);

  // Mailboxes. The backend's stack name is resolved (one backend per install),
  // not typed — there's no editable stack-name field anymore.
  const stackName = resolveStackName();
  const [mbEmail, setMbEmail] = useState("");
  const [mbPassword, setMbPassword] = useState("");
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [mbBackend, setMbBackend] = useState<BackendInfo | null>(null);
  const [mbBusy, setMbBusy] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  const [mbNoBackend, setMbNoBackend] = useState(false);
  const [mbCreated, setMbCreated] = useState<string | null>(null);

  // The sidecar may still be booting when the view mounts; retry a few times
  // before declaring it unreachable so the user sees a loader, not an error.
  async function loadReadiness(attempt = 0) {
    setChecking(true);
    setError(null);
    try {
      setReadiness(await sidecar<Readiness>("/aws/readiness"));
      setChecking(false);
    } catch (e) {
      if (attempt < 8) {
        retryRef.current = window.setTimeout(() => void loadReadiness(attempt + 1), 1200);
      } else {
        setError(
          `Could not reach the local provisioning helper after several tries. Make sure the app's sidecar is running (it starts automatically with the desktop app). ${String(e)}`,
        );
        setChecking(false);
      }
    }
  }
  useEffect(() => {
    void loadReadiness();
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(e: unknown, back?: Step) {
    setError(String(e));
    setBusy(false);
    if (back) setStep(back);
  }

  function askConfirm(message: string, run: () => void) {
    setConfirmAction({ message, run });
  }

  async function runPreflight() {
    setError(null);
    setBusy(true);
    try {
      setPreflight(await sidecar<Preflight>(`/aws/preflight/${encodeURIComponent(domain)}`));
      setStep("preflighted");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // Step 2 — deploy the full backend stack via CloudFormation (no terminal/cdk).
  function onDeploy() {
    askConfirm(
      `Deploy the Mailpoppy backend for ${domain} into your AWS account? This creates a CloudFormation stack (S3, DynamoDB, Lambdas, API, Cognito) — real resources in your account.`,
      runDeploy,
    );
  }
  async function runDeploy() {
    setError(null);
    setBusy(true);
    setStep("deploying");
    try {
      await deployBackend({ domain, enableMalwareProtection: enableMalware });
    } catch (e) {
      fail(e, "preflighted");
      return;
    } finally {
      setBusy(false);
    }
  }

  // Poll the deploy until the stack settles; on success persist the client config.
  useEffect(() => {
    if (step !== "deploying") return;
    let cancelled = false;
    async function poll() {
      try {
        const s = await deployStatus("MailpoppyMailStack");
        if (cancelled) return;
        setDeploy(s);
        if (s.failed) {
          setError(`Backend deploy failed (${s.status})${s.reason ? `: ${s.reason}` : ""}.`);
          setStep("preflighted");
          return;
        }
        if (s.complete) {
          const o = s.outputs ?? {};
          if (o.ApiBaseUrl && o.UserPoolId && o.UserPoolClientId) {
            saveDeploymentConfig({
              apiBaseUrl: o.ApiBaseUrl,
              userPoolId: o.UserPoolId,
              clientId: o.UserPoolClientId,
              region: o.DeployRegion || "eu-west-1",
              stackName: DEFAULT_STACK_NAME,
            });
          }
          setStep("deployed");
          return;
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStep("preflighted");
        }
        return;
      }
      deployPollRef.current = window.setTimeout(poll, 5000);
    }
    poll();
    return () => {
      cancelled = true;
      if (deployPollRef.current) window.clearTimeout(deployPollRef.current);
    };
  }, [step, domain]);

  function provisionDomain() {
    askConfirm(
      `Set up mail DNS for ${domain}? This verifies the domain in SES and publishes DKIM/MX/DMARC records.`,
      runProvision,
    );
  }
  async function runProvision() {
    setError(null);
    setBusy(true);
    setStep("provisioning");
    try {
      setProvision(await sidecar<ProvisionResult>(`/provision/${encodeURIComponent(domain)}`, { method: "POST" }));
      setStep("verifying");
    } catch (e) {
      fail(e, "preflighted");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step !== "verifying") return;
    let cancelled = false;
    async function poll() {
      try {
        const s = await sidecar<IdentityStatus>(`/provision/${encodeURIComponent(domain)}/status`);
        if (cancelled) return;
        setStatus(s);
        if (s.dkim === "SUCCESS" && s.verifiedForSending) {
          setStep("verified");
          return;
        }
      } catch (e) {
        if (!cancelled) fail(e);
        return;
      }
      pollRef.current = window.setTimeout(poll, 4000);
    }
    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [step, domain]);

  async function sendTest() {
    setError(null);
    setBusy(true);
    setStep("sending");
    try {
      const r = await sidecar<{ ok: boolean; messageId: string }>(
        `/provision/${encodeURIComponent(domain)}/test`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: recipient }) },
      );
      setMessageId(r.messageId);
      setStep("sent");
    } catch (e) {
      fail(e, "verified");
    } finally {
      setBusy(false);
    }
  }

  const ready = readiness?.ready === true;

  // ---- Mailboxes ----
  async function loadMailboxes() {
    setMbError(null);
    setMbNoBackend(false);
    try {
      const res = await listMailboxes(stackName);
      setMailboxes(res.mailboxes);
      setMbBackend({ region: res.region, userPoolId: res.userPoolId, clientId: res.clientId, apiBaseUrl: res.apiBaseUrl });
    } catch (e) {
      setMailboxes(null);
      setMbBackend(null);
      const msg = String(e);
      // A 404 here just means the backend stack isn't deployed yet — the
      // expected state on first launch, not an error. Show the deploy hint
      // instead of an alarming red banner.
      if (/\b404\b/.test(msg) && /No deployed Mailpoppy backend/i.test(msg)) {
        setMbNoBackend(true);
      } else {
        setMbError(msg);
      }
    }
  }
  // Auto-load the mailbox list once the environment is ready.
  useEffect(() => {
    if (ready) void loadMailboxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stackName]);

  // After an in-session deploy finishes, the backend stack now exists. The
  // effect above already ran (and 404'd) before the stack was created, so
  // re-query here to clear the stale "no backend yet" state and enable
  // "Create mailbox" — without forcing an app restart.
  useEffect(() => {
    if (ready && step === "deployed") void loadMailboxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function createMb() {
    setMbBusy(true);
    setMbError(null);
    setMbCreated(null);
    try {
      const res = await createMailbox({ email: mbEmail, password: mbPassword, stackName });
      setMbCreated(res.mailbox.email);
      setMbPassword("");
      // Persist the backend config so the Inbox tab is ready to sign in.
      if (res.apiBaseUrl && res.userPoolId && res.clientId) {
        saveDeploymentConfig({
          apiBaseUrl: res.apiBaseUrl,
          userPoolId: res.userPoolId,
          clientId: res.clientId,
          region: res.region,
          stackName,
        });
      }
      await loadMailboxes();
    } catch (e) {
      setMbError(String(e));
    } finally {
      setMbBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* In-app confirmation dialog (native window.confirm is unreliable in the
          Tauri webview). */}
      {confirmAction && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-outline-variant/20 bg-surface-container p-6 shadow-2xl">
            <p className="mb-5 text-sm leading-relaxed text-on-surface">{confirmAction.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const run = confirmAction.run;
                  setConfirmAction(null);
                  run();
                }}
              >
                Yes, continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Intro */}
      <div>
        <div className="font-mono text-xs uppercase tracking-wider text-primary">Environment Setup</div>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-on-surface">
          <Sparkles className="size-5 text-primary" />
          Configure your Mailpoppy backend
        </h2>
        <p className="mt-1 max-w-2xl text-on-surface-variant">
          Provision the SES, Route53, Lambda and Cognito resources for your domain — all in your own AWS account. Your
          credentials never leave this machine.
        </p>
      </div>

      {/* Two columns (Stitch layout): the main step content fills the left; the
          reassuring guidance ("messages to the user") sits in a sticky right
          column so it doesn't push the main content down the page. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* ---- Data residency: choose the AWS region ---- */}
          <Card>
            <RegionPicker lockedRegion={loadDeploymentConfig()?.region} />
          </Card>

      {/* ---- Step 0: AWS environment ---- */}
      <StepCard step="Step 0" title="AWS environment">
        {checking && (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner /> Starting Mailpoppy and checking your AWS environment…{" "}
            <span className="text-on-surface-variant/60">(this can take a few seconds)</span>
          </div>
        )}
        {readiness && (
          <div className="flex flex-col gap-3 text-sm">
            {/* AWS CLI */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-3">
              <span className="flex items-center gap-2 text-on-surface-variant">
                <Terminal className="size-4" /> AWS CLI
              </span>
              {readiness.cli.installed ? (
                <OkBadge>{readiness.cli.version}</OkBadge>
              ) : (
                <span className="font-mono text-xs text-on-surface-variant/70">not found (optional — reads ~/.aws directly)</span>
              )}
            </div>
            {/* Credentials */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-3">
              <span className="flex items-center gap-2 text-on-surface-variant">
                <KeyRound className="size-4" /> Credentials
              </span>
              {readiness.credentials.ok ? (
                <span className="flex items-center gap-2">
                  <OkBadge>Found</OkBadge>
                  <span className="font-mono text-xs text-on-surface-variant">
                    {readiness.credentials.arn} (account {readiness.credentials.account})
                  </span>
                </span>
              ) : (
                <span className="text-tertiary">
                  ⛔ No usable AWS credentials{readiness.credentials.error ? `: ${readiness.credentials.error}` : ""}
                </span>
              )}
            </div>
            {/* Permissions */}
            {readiness.credentials.ok && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-on-surface-variant">Permissions:</span>
                {SERVICES.map((k) => (
                  <span
                    key={k}
                    className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs", permTone(readiness.permissions[k]))}
                  >
                    {permIcon(readiness.permissions[k])} {k}
                  </span>
                ))}
              </div>
            )}

            {!ready && (
              <Warn>
                <b>Action needed before setup:</b>
                <ul className="ml-4 mt-1.5 list-disc space-y-2">
                  {!readiness.credentials.ok && (
                    <li>
                      <b>Make AWS credentials available, then re-check.</b>
                      <div className="mt-1">
                        The app uses your AWS credential profiles in <C>~/.aws/credentials</C> and <C>~/.aws/config</C>. To
                        target a specific one, start the app with <C>AWS_PROFILE=&lt;profile-name&gt; AWS_REGION=eu-west-1</C>.
                      </div>
                      <ul className="ml-4 mt-1 list-disc space-y-1">
                        <li>
                          <C>&lt;profile-name&gt;</C> is the <b>name</b> in brackets in those files (e.g. <C>[default]</C> →{" "}
                          <C>default</C>) — <b>not</b> your AWS account number. List them with <C>aws configure list-profiles</C>.
                        </li>
                        <li>
                          If you have a <C>[default]</C> profile, you can omit <C>AWS_PROFILE</C> entirely.
                        </li>
                        <li>
                          No profiles yet? Run <C>aws configure</C>
                          {readiness.cli.installed ? "" : " (after installing the AWS CLI)"} or <C>aws sso login</C>.
                        </li>
                      </ul>
                    </li>
                  )}
                  {readiness.credentials.ok &&
                    SERVICES.filter((k) => readiness.permissions[k] !== "ok").map((k) => (
                      <li key={k}>
                        <b>{k}</b>: {readiness.permissions[k] === "denied" ? "access denied — this identity lacks permission" : "could not verify"}.
                        Attach <b>AdministratorAccess</b> (or the Mailpoppy provisioning policy) to <C>{readiness.credentials.arn}</C>.
                      </li>
                    ))}
                </ul>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadReadiness()} disabled={checking}>
                  <RefreshCw className="size-3.5" /> Re-check
                </Button>
              </Warn>
            )}
            {ready && (
              <div className="flex items-center gap-2 font-medium text-secondary">
                <ShieldCheck className="size-4" /> Environment ready — you can set up a domain.
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* ---- Steps 1–4 (gated on readiness) ---- */}
      <StepCard step="Steps 1–4" title="Set up a domain">
        {!ready && <p className="mb-3 text-sm text-on-surface-variant">Complete Step 0 first.</p>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
            Domain
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="yourdomain.com"
              disabled={!ready || step !== "start"}
              className={cn(inputCls, "w-64")}
              {...noAutoCap}
            />
          </label>
          <Button onClick={runPreflight} disabled={!ready || !domain || busy || step !== "start"}>
            <Globe className="size-4" /> 1. Check AWS &amp; DNS
          </Button>
        </div>

        {preflight && (
          <div className="mt-4 flex flex-col gap-2 text-sm text-on-surface">
            <div className="flex items-center gap-1.5 text-secondary">
              <ShieldCheck className="size-4" /> Account <C>{preflight.accountId}</C> · region <C>{preflight.region}</C>
            </div>
            <div className="flex items-center gap-1.5 text-secondary">
              <ShieldCheck className="size-4" /> Hosted zone <C>{preflight.zoneId}</C>
            </div>
            {step === "preflighted" && (
              <div className="mt-2">
                <label className="mb-3 flex max-w-lg items-start gap-2 text-sm text-on-surface-variant">
                  <input type="checkbox" checked={enableMalware} onChange={(e) => setEnableMalware(e.target.checked)} className="mt-1 size-4 accent-primary" />
                  <span>
                    <b className="text-on-surface">Scan attachments for malware</b> <span className="text-secondary">(recommended)</span> —
                    adds AWS GuardDuty Malware Protection on your mail storage; infected files are blocked from download. Small
                    AWS usage cost (a personal mailbox is usually within the free tier).
                  </span>
                </label>
                <Button onClick={onDeploy} disabled={busy}>
                  <Rocket className="size-4" /> 2. Deploy backend
                </Button>
              </div>
            )}
          </div>
        )}

        {step === "deploying" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner /> Deploying the backend stack… <C>{deploy?.status ?? "starting"}</C>{" "}
            <span className="text-on-surface-variant/60">(CloudFormation — this usually takes 1–3 minutes)</span>
          </div>
        )}

        {(step === "deployed" || step === "provisioning" || step === "verifying" || step === "verified" || step === "sending" || step === "sent") &&
          deploy?.outputs?.ApiBaseUrl && (
            <div className="mt-4 text-sm text-on-surface">
              <span className="text-secondary">✅ Backend deployed</span> · API <C>{deploy.outputs.ApiBaseUrl}</C> · the Inbox
              tab is now connected.
              {step === "deployed" && (
                <div className="mt-3">
                  <Button onClick={provisionDomain} disabled={busy}>
                    <Globe className="size-4" /> 3. Set up domain mail (SES + DNS)
                  </Button>
                </div>
              )}
            </div>
          )}

        {provision?.ok && (
          <div className="mt-4 text-sm text-secondary">
            ✅ Domain mail set up · {provision.dkimTokens.length} DKIM records + MX/DMARC published.
          </div>
        )}

        {step === "verifying" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner /> Verifying DKIM… <C>{status?.dkim ?? "pending"}</C> (polling every 4s).
          </div>
        )}

        {(step === "verified" || step === "sending" || step === "sent") && (
          <div className="mt-4 text-sm text-on-surface">
            <div className="flex items-center gap-1.5 text-secondary">
              <ShieldCheck className="size-4" /> DKIM verified — ready to send.
            </div>
            <p className="my-2 text-sm text-on-surface-variant">
              Send a test to a <b className="text-on-surface">personal inbox you can open</b> — e.g. your Gmail or Outlook
              address (not an address on this domain). Check it lands in the inbox (not spam) with SPF/DKIM/DMARC = PASS.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
                Your personal email address
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())}
                  placeholder="you@gmail.com"
                  disabled={step !== "verified"}
                  className={cn(inputCls, "w-64")}
                  {...noAutoCap}
                />
              </label>
              <Button onClick={sendTest} disabled={busy || step !== "verified" || !recipient}>
                <Mail className="size-4" /> 4. Send deliverability test
              </Button>
            </div>
          </div>
        )}

        {step === "sending" && (
          <p className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant">
            <Spinner /> Sending…
          </p>
        )}

        {step === "sent" && (
          <div className="mt-4 text-sm text-on-surface">
            🎉 Sent (message <C>{messageId}</C>). Check <b>{recipient}</b> — it should be in the inbox (not spam). Open{" "}
            <b>Show original</b> to confirm SPF/DKIM/DMARC = PASS.
          </div>
        )}

        {error && <p className="mt-3 text-sm text-tertiary">{error}</p>}
      </StepCard>

      {/* ---- Sending access (SES sandbox → production) + deliverability ---- */}
      {ready && (
        <Card>
          <SendingAccessView defaultWebsite={domain || undefined} />
          {domain && <MailFromSetup domain={domain} region={preflight?.region} />}
        </Card>
      )}

      {/* ---- Mailboxes (Cognito users in the deployed backend) ---- */}
      {ready && (
        <Card>
          <h2 className="text-lg font-semibold text-on-surface">Mailboxes</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            A mailbox is a user that can sign in to the Inbox. Mailboxes live in your deployed backend (Cognito), so the
            backend stack must be deployed first.
          </p>

          {mbNoBackend && (
            <Warn className="mt-3">
              No backend deployed yet. Set up a domain above and run the <b>Deploy backend</b> step to create it — then come
              back here to add mailboxes.
            </Warn>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
              Email address
              <input
                aria-label="Mailbox email"
                value={mbEmail}
                onChange={(e) => setMbEmail(e.target.value.trim().toLowerCase())}
                placeholder="you@yourdomain.com"
                className={cn(inputCls, "w-64")}
                {...noAutoCap}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
              Password
              <input
                aria-label="Mailbox password"
                type="password"
                value={mbPassword}
                onChange={(e) => setMbPassword(e.target.value)}
                className={cn(inputCls, "w-64")}
              />
            </label>
            <Button onClick={() => void createMb()} disabled={mbBusy || mbNoBackend || !mbEmail || !mbPassword}>
              {mbBusy ? <Spinner className="border-white/40 border-t-white" /> : null}
              {mbBusy ? "Creating…" : "Create mailbox"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-on-surface-variant/70">
            Password must meet the pool policy (min 8 chars, with upper &amp; lower case, a number and a symbol).
          </p>

          {mbCreated && (
            <div className="mt-3 rounded-lg border border-secondary/30 bg-secondary/10 p-4 text-sm text-on-surface">
              ✅ Mailbox <b>{mbCreated}</b> created. The <b>Inbox</b> tab is now connected to this backend — go there and sign
              in as <C>{mbCreated}</C>.
            </div>
          )}
          {mbError && <div className="mt-3 rounded-lg border border-tertiary/30 bg-tertiary-container/10 p-4 text-sm text-tertiary">{mbError}</div>}

          {mailboxes && (
            <div className="mt-4 text-sm">
              <div className="flex items-center justify-between">
                <strong className="text-on-surface">Existing mailboxes ({mailboxes.length})</strong>
                {mbBackend && (
                  <span className="font-mono text-xs text-on-surface-variant">
                    backend <C>{stackName}</C> · pool <C>{mbBackend.userPoolId}</C> · {mbBackend.region}
                  </span>
                )}
              </div>
              {mailboxes.length === 0 ? (
                <p className="mt-2 text-sm text-on-surface-variant">No mailboxes yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {mailboxes.map((m) => (
                    <MailboxStorageRow
                      key={m.email}
                      email={m.email}
                      status={m.status}
                      stackName={stackName}
                      onDeleted={() => void loadMailboxes()}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

          {/* Mail rules + retention are account-wide (one backend per install),
              so they live in the Account tab — not here, where the focus is
              first-domain onboarding. */}
        </div>

        {/* Right column — guidance ("running this the right way"). */}
        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-0">
            <AdminPrivacyNotice />
          </div>
        </aside>
      </div>
    </div>
  );
}
