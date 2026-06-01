import { useEffect, useRef, useState } from "react";
import { sidecar } from "../lib/sidecar";

// Phase 1 setup wizard.
// Step 0 verifies the AWS environment (credentials + per-service permissions, + detects
// the optional CLI) so provisioning never fails halfway. Then, once ready:
//   1. preflight → 2. provision → poll DKIM → 3. send deliverability test.

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
  bucket: string;
  dkimTokens: string[];
}
interface IdentityStatus {
  verifiedForSending: boolean;
  dkim: string;
}

type Step = "start" | "preflighted" | "provisioning" | "verifying" | "verified" | "sending" | "sent";
const SERVICES = ["route53", "ses", "sesv2", "s3"] as const;

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const warn: React.CSSProperties = { marginTop: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: 10 };

const permIcon = (v: "ok" | "denied" | "error") => (v === "ok" ? "✅" : v === "denied" ? "⛔" : "⚠️");

export function SetupWizard() {
  // Step 0 — environment readiness
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(true);

  // Steps 1–3
  const [domain, setDomain] = useState("");
  const [recipient, setRecipient] = useState("leonct74@gmail.com");
  const [step, setStep] = useState<Step>("start");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  async function loadReadiness() {
    setChecking(true);
    setError(null);
    try {
      setReadiness(await sidecar<Readiness>("/aws/readiness"));
    } catch (e) {
      setError(`Could not reach the provisioning sidecar — is it running? ${String(e)}`);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void loadReadiness();
  }, []);

  function fail(e: unknown, back?: Step) {
    setError(String(e));
    setBusy(false);
    if (back) setStep(back);
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

  async function provisionDomain() {
    if (!confirm(`Provision Mailpoppy for ${domain}? This creates AWS resources and changes DNS.`)) return;
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

  return (
    <>
      {/* ---- Step 0: AWS environment ---- */}
      <section style={box}>
        <h2>Step 0 · AWS environment</h2>
        {checking && <p style={{ fontSize: 14 }}>Checking your AWS environment…</p>}
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
                      Make AWS credentials available, then re-check: launch the sidecar with{" "}
                      <code style={mono}>AWS_PROFILE=&lt;profile&gt; AWS_REGION=eu-west-1</code>, or{" "}
                      {readiness.cli.installed ? (
                        <>run <code style={mono}>aws sso login</code> / <code style={mono}>aws configure</code>.</>
                      ) : (
                        <>install the AWS CLI and run <code style={mono}>aws configure</code> (or set <code style={mono}>AWS_*</code> env vars).</>
                      )}
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
                <button onClick={loadReadiness} disabled={checking} style={{ marginTop: 8 }}>
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
            onChange={(e) => setDomain(e.target.value.trim())}
            placeholder="ollydigital.com"
            disabled={!ready || step !== "start"}
            style={{ padding: 6, minWidth: 240 }}
          />
        </label>{" "}
        <button onClick={runPreflight} disabled={!ready || !domain || busy || step !== "start"}>
          1. Check AWS &amp; DNS
        </button>

        {preflight && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>✅ Account <code style={mono}>{preflight.accountId}</code> · region <code style={mono}>{preflight.region}</code></div>
            <div>✅ Hosted zone <code style={mono}>{preflight.zoneId}</code></div>
            {step === "preflighted" && (
              <button onClick={provisionDomain} disabled={busy} style={{ marginTop: 8 }}>
                2. Provision (creates resources + DNS)
              </button>
            )}
          </div>
        )}

        {provision?.ok && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            ✅ Provisioned · bucket <code style={mono}>{provision.bucket}</code> · {provision.dkimTokens.length} DKIM records published.
          </div>
        )}

        {step === "verifying" && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            ⏳ Verifying DKIM… <code style={mono}>{status?.dkim ?? "pending"}</code> (polling every 4s).
          </div>
        )}

        {(step === "verified" || step === "sending" || step === "sent") && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>✅ DKIM verified — ready to send.</div>
            <label>
              Send a test to{" "}
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                disabled={step !== "verified"}
                style={{ padding: 6, minWidth: 240 }}
              />
            </label>{" "}
            <button onClick={sendTest} disabled={busy || step !== "verified"}>
              3. Send deliverability test
            </button>
          </div>
        )}

        {step === "sending" && <p style={{ fontSize: 14 }}>📤 Sending…</p>}

        {step === "sent" && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            🎉 Sent (message <code style={mono}>{messageId}</code>). Check <b>{recipient}</b> — it should be in the inbox
            (not spam). Open <b>Show original</b> to confirm SPF/DKIM/DMARC = PASS.
          </div>
        )}

        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </section>
    </>
  );
}
