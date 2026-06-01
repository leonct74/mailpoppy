import { useState } from "react";
import { sidecar } from "../lib/sidecar";

// Phase 1 setup wizard (skeleton). Drives the provisioning sidecar, which runs
// the validated Phase 0 sequence. The "Provision" step is mutating, so it is
// gated behind an explicit confirmation (DESIGN §6 / CLAUDE working agreements).

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

export function SetupWizard() {
  const [domain, setDomain] = useState("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreflight() {
    setError(null);
    setBusy(true);
    try {
      setPreflight(await sidecar<Preflight>(`/aws/preflight/${encodeURIComponent(domain)}`));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    if (!confirm(`Provision Mailpoppy for ${domain}? This creates AWS resources and changes DNS.`))
      return;
    setError(null);
    setBusy(true);
    try {
      setResult(
        await sidecar<ProvisionResult>(`/provision/${encodeURIComponent(domain)}`, { method: "POST" }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16 }}>
      <h2>Set up a domain</h2>
      <label>
        Domain{" "}
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value.trim())}
          placeholder="ollydigital.com"
          style={{ padding: 6, minWidth: 240 }}
        />
      </label>{" "}
      <button onClick={runPreflight} disabled={!domain || busy}>
        1. Check AWS &amp; DNS
      </button>

      {preflight && (
        <div style={{ marginTop: 12, fontSize: 14 }}>
          <div>✅ Account <code>{preflight.accountId}</code> · region <code>{preflight.region}</code></div>
          <div>✅ Hosted zone <code>{preflight.zoneId}</code></div>
          <button onClick={provision} disabled={busy} style={{ marginTop: 8 }}>
            2. Provision (creates resources + DNS)
          </button>
        </div>
      )}

      {result?.ok && (
        <div style={{ marginTop: 12, fontSize: 14 }}>
          🎉 Provisioned. Bucket <code>{result.bucket}</code>. DKIM verifying — the wizard will
          poll <code>/provision/{domain}/status</code> until SUCCESS, then run the deliverability test.
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </section>
  );
}
