import { useEffect, useRef, useState } from "react";
import { sidecar } from "../lib/sidecar";

// Phase 1 setup wizard. Drives the provisioning sidecar through the full loop:
//   preflight → provision → poll DKIM → send deliverability test.
// Mutating steps are gated behind explicit confirmation (DESIGN §6 / CLAUDE working agreements).

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

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

export function SetupWizard() {
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
      setStep("verifying"); // triggers the DKIM poll below
    } catch (e) {
      fail(e, "preflighted");
    } finally {
      setBusy(false);
    }
  }

  // Auto-poll DKIM status while "verifying"; advance to "verified" on SUCCESS.
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

  return (
    <section style={box}>
      <h2>Set up a domain</h2>

      <label>
        Domain{" "}
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value.trim())}
          placeholder="ollydigital.com"
          disabled={step !== "start"}
          style={{ padding: 6, minWidth: 240 }}
        />
      </label>{" "}
      <button onClick={runPreflight} disabled={!domain || busy || step !== "start"}>
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
          ⏳ Verifying DKIM… <code style={mono}>{status?.dkim ?? "pending"}</code> (polls every 4s; usually under a minute, can take longer on first setup).
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
          🎉 Sent (message <code style={mono}>{messageId}</code>). Check <b>{recipient}</b> — it should be in the
          inbox (not spam). Open <b>Show original</b> to confirm SPF/DKIM/DMARC = PASS.
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </section>
  );
}
