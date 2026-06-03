import { useEffect, useRef, useState } from "react";
import { sidecar } from "../lib/sidecar";
import { createMailbox, listMailboxes, type Mailbox, type BackendInfo } from "../lib/mailbox";
import { deployBackend, deployStatus, type DeployStatus } from "../lib/deploy";
import { saveDeploymentConfig } from "../lib/deploymentConfig";

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

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const warn: React.CSSProperties = { marginTop: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: 10 };
const input: React.CSSProperties = { padding: 6, minWidth: 240 };
const noAutoCap = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;
// Prominent style for the numbered flow actions (the "Deploy backend" button was
// too small to notice before).
const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 600,
  color: "#fff",
  background: "#7c3aed",
  border: "none",
  borderRadius: 8,
};
const pBtn = (disabled: boolean): React.CSSProperties => ({
  ...primaryBtn,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? "default" : "pointer",
});

const permIcon = (v: "ok" | "denied" | "error") => (v === "ok" ? "✅" : v === "denied" ? "⛔" : "⚠️");

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        border: "2px solid #ddd",
        borderTopColor: "#7c3aed",
        borderRadius: "50%",
        animation: "mp-spin 0.8s linear infinite",
        verticalAlign: "-3px",
        marginRight: 8,
      }}
    />
  );
}

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
  const deployPollRef = useRef<number | null>(null);

  // Mailboxes
  const [stackName, setStackName] = useState("MailpoppyMailStack");
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
      await deployBackend({ domain });
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
    <>
      <style>{`@keyframes mp-spin { to { transform: rotate(360deg); } }`}</style>

      {/* In-app confirmation dialog (native window.confirm is unreliable in the
          Tauri webview). */}
      {confirmAction && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 460, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.5 }}>{confirmAction.message}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmAction(null)} style={{ padding: "8px 16px" }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  const run = confirmAction.run;
                  setConfirmAction(null);
                  run();
                }}
                style={{ ...primaryBtn, padding: "8px 16px" }}
              >
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Step 0: AWS environment ---- */}
      <section style={box}>
        <h2>Step 0 · AWS environment</h2>
        {checking && (
          <div style={{ display: "flex", alignItems: "center", fontSize: 14, color: "#555" }}>
            <Spinner />
            Starting Mailpoppy and checking your AWS environment… <span style={{ color: "#999", marginLeft: 6 }}>(this can take a few seconds)</span>
          </div>
        )}
        {readiness && (
          <div style={{ fontSize: 14 }}>
            <div>
              {readiness.cli.installed
                ? `✅ AWS CLI: ${readiness.cli.version}`
                : "ℹ️ AWS CLI not found (optional — the app reads ~/.aws directly)"}
            </div>
            <div>
              {readiness.credentials.ok ? (
                <>✅ Credentials: <code style={mono}>{readiness.credentials.arn}</code> (account {readiness.credentials.account})</>
              ) : (
                <>⛔ No usable AWS credentials{readiness.credentials.error ? `: ${readiness.credentials.error}` : ""}</>
              )}
            </div>
            {readiness.credentials.ok && (
              <div>
                Permissions:{" "}
                {SERVICES.map((k) => (
                  <span key={k} style={{ marginRight: 10 }}>
                    {permIcon(readiness.permissions[k])} {k}
                  </span>
                ))}
              </div>
            )}

            {!ready && (
              <div style={warn}>
                <b>Action needed before setup:</b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {!readiness.credentials.ok && (
                    <li>
                      <b>Make AWS credentials available, then re-check.</b>
                      <div style={{ marginTop: 4 }}>
                        The app uses your AWS credential profiles in{" "}
                        <code style={mono}>~/.aws/credentials</code> and <code style={mono}>~/.aws/config</code>. To target a
                        specific one, start the app with{" "}
                        <code style={mono}>AWS_PROFILE=&lt;profile-name&gt; AWS_REGION=eu-west-1</code>.
                      </div>
                      <ul style={{ margin: "4px 0 0 18px" }}>
                        <li>
                          <code style={mono}>&lt;profile-name&gt;</code> is the <b>name</b> in brackets in those files (e.g.{" "}
                          <code style={mono}>[default]</code> → <code style={mono}>default</code>) — <b>not</b> your AWS account
                          number. List them with <code style={mono}>aws configure list-profiles</code>.
                        </li>
                        <li>
                          If you have a <code style={mono}>[default]</code> profile, you can omit <code style={mono}>AWS_PROFILE</code> entirely.
                        </li>
                        <li>
                          No profiles yet? Run <code style={mono}>aws configure</code>
                          {readiness.cli.installed ? "" : " (after installing the AWS CLI)"} or{" "}
                          <code style={mono}>aws sso login</code>.
                        </li>
                      </ul>
                    </li>
                  )}
                  {readiness.credentials.ok &&
                    SERVICES.filter((k) => readiness.permissions[k] !== "ok").map((k) => (
                      <li key={k}>
                        <b>{k}</b>: {readiness.permissions[k] === "denied" ? "access denied — this identity lacks permission" : "could not verify"}.
                        Attach <b>AdministratorAccess</b> (or the Mailpoppy provisioning policy) to{" "}
                        <code style={mono}>{readiness.credentials.arn}</code>.
                      </li>
                    ))}
                </ul>
                <button onClick={() => void loadReadiness()} disabled={checking} style={{ marginTop: 8 }}>
                  Re-check
                </button>
              </div>
            )}
            {ready && <div style={{ marginTop: 6, color: "#15803d" }}>✅ Environment ready — you can set up a domain.</div>}
          </div>
        )}
      </section>

      {/* ---- Steps 1–3 (gated on readiness) ---- */}
      <section style={box}>
        <h2>Set up a domain</h2>
        {!ready && <p style={{ fontSize: 14, color: "#666" }}>Complete Step 0 first.</p>}

        <label>
          Domain{" "}
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
            placeholder="yourdomain.com"
            disabled={!ready || step !== "start"}
            style={input}
            {...noAutoCap}
          />
        </label>{" "}
        <button
          onClick={runPreflight}
          disabled={!ready || !domain || busy || step !== "start"}
          style={pBtn(!ready || !domain || busy || step !== "start")}
        >
          1. Check AWS &amp; DNS
        </button>

        {preflight && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>✅ Account <code style={mono}>{preflight.accountId}</code> · region <code style={mono}>{preflight.region}</code></div>
            <div>✅ Hosted zone <code style={mono}>{preflight.zoneId}</code></div>
            {step === "preflighted" && (
              <button onClick={onDeploy} disabled={busy} style={{ ...pBtn(busy), marginTop: 10 }}>
                2. Deploy backend
              </button>
            )}
          </div>
        )}

        {step === "deploying" && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <Spinner />
            Deploying the backend stack… <code style={mono}>{deploy?.status ?? "starting"}</code>{" "}
            <span style={{ color: "#999" }}>(CloudFormation — this usually takes 1–3 minutes)</span>
          </div>
        )}

        {(step === "deployed" || step === "provisioning" || step === "verifying" || step === "verified" || step === "sending" || step === "sent") &&
          deploy?.outputs?.ApiBaseUrl && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              ✅ Backend deployed · API <code style={mono}>{deploy.outputs.ApiBaseUrl}</code> · the Inbox tab is now connected.
              {step === "deployed" && (
                <div>
                  <button onClick={provisionDomain} disabled={busy} style={{ ...pBtn(busy), marginTop: 10 }}>
                    3. Set up domain mail (SES + DNS)
                  </button>
                </div>
              )}
            </div>
          )}

        {provision?.ok && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            ✅ Domain mail set up · {provision.dkimTokens.length} DKIM records + MX/DMARC published.
          </div>
        )}

        {step === "verifying" && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <Spinner />
            Verifying DKIM… <code style={mono}>{status?.dkim ?? "pending"}</code> (polling every 4s).
          </div>
        )}

        {(step === "verified" || step === "sending" || step === "sent") && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>✅ DKIM verified — ready to send.</div>
            <label>
              Send a test to{" "}
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())}
                placeholder="you@example.com"
                disabled={step !== "verified"}
                style={input}
                {...noAutoCap}
              />
            </label>{" "}
            <button onClick={sendTest} disabled={busy || step !== "verified" || !recipient} style={pBtn(busy || step !== "verified" || !recipient)}>
              4. Send deliverability test
            </button>
          </div>
        )}

        {step === "sending" && (
          <p style={{ fontSize: 14 }}>
            <Spinner />
            Sending…
          </p>
        )}

        {step === "sent" && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            🎉 Sent (message <code style={mono}>{messageId}</code>). Check <b>{recipient}</b> — it should be in the inbox
            (not spam). Open <b>Show original</b> to confirm SPF/DKIM/DMARC = PASS.
          </div>
        )}

        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </section>

      {/* ---- Mailboxes (Cognito users in the deployed backend) ---- */}
      {ready && (
        <section style={box}>
          <h2>Mailboxes</h2>
          <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
            A mailbox is a user that can sign in to the Inbox. Mailboxes live in your deployed backend (Cognito), so the
            backend stack must be deployed first.
          </p>

          {mbNoBackend && (
            <div style={warn}>
              No backend deployed yet. Set up a domain above and run the <b>Deploy backend</b> step to create it — then come
              back here to add mailboxes.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 13 }}>
              Email address
              <br />
              <input
                aria-label="Mailbox email"
                value={mbEmail}
                onChange={(e) => setMbEmail(e.target.value.trim().toLowerCase())}
                placeholder="you@yourdomain.com"
                style={input}
                {...noAutoCap}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              Password
              <br />
              <input
                aria-label="Mailbox password"
                type="password"
                value={mbPassword}
                onChange={(e) => setMbPassword(e.target.value)}
                style={input}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              Stack name
              <br />
              <input aria-label="Stack name" value={stackName} onChange={(e) => setStackName(e.target.value.trim())} style={{ ...input, minWidth: 200 }} {...noAutoCap} />
            </label>
            <button
              onClick={() => void createMb()}
              disabled={mbBusy || mbNoBackend || !mbEmail || !mbPassword}
              style={pBtn(mbBusy || mbNoBackend || !mbEmail || !mbPassword)}
            >
              {mbBusy ? "Creating…" : "Create mailbox"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
            Password must meet the pool policy (min 8 chars, with upper &amp; lower case, a number and a symbol).
          </p>

          {mbCreated && (
            <div style={{ ...box, marginTop: 10, borderColor: "#bbf7d0", background: "#f0fdf4" }}>
              ✅ Mailbox <b>{mbCreated}</b> created. The <b>Inbox</b> tab is now connected to this backend — go there and sign in
              as <code style={mono}>{mbCreated}</code>.
            </div>
          )}
          {mbError && (
            <div style={{ ...warn, background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>{mbError}</div>
          )}

          {mailboxes && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>Existing mailboxes ({mailboxes.length})</strong>
                {mbBackend && (
                  <span style={{ color: "#666", fontSize: 12 }}>
                    pool <code style={mono}>{mbBackend.userPoolId}</code> · {mbBackend.region}
                  </span>
                )}
              </div>
              {mailboxes.length === 0 ? (
                <p style={{ color: "#666", fontSize: 13 }}>No mailboxes yet.</p>
              ) : (
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {mailboxes.map((m) => (
                    <li key={m.email}>
                      <code style={mono}>{m.email}</code> <span style={{ color: "#999" }}>· {m.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
