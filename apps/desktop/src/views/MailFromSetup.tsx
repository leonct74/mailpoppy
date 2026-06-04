import { useEffect, useState } from "react";
import {
  mailFromAlignment,
  defaultMailFromDomain,
  mailFromDnsRecords,
  type MailFromState,
  type DnsRecord,
} from "@mailpoppy/core";
import {
  getMailFromStatus as defaultGetMailFromStatus,
  setupMailFrom as defaultSetupMailFrom,
  type SetupMailFromResult,
} from "../lib/mailFrom";

// "Improve deliverability (SPF alignment)" card for the wizard's Sending-access
// section. SES's default Return-Path (…amazonses.com) leaves SPF unaligned to the
// sender's domain, which picky providers (Outlook/Hotmail) penalize. Configuring a
// custom MAIL FROM subdomain + its DNS makes SPF align too. load/setup are
// injectable so the card is unit-tested without a live sidecar.

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const btn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: disabled ? "#cbd5e1" : "#7c3aed",
  color: "#fff",
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});

function banner(bg: string, border: string, color: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 8, padding: "10px 12px", fontSize: 14 };
}

function RecordsTable({ records }: { records: DnsRecord[] }) {
  return (
    <table style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#666" }}>
          <th style={{ paddingRight: 16 }}>Type</th>
          <th style={{ paddingRight: 16 }}>Name</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={`${r.type}-${r.name}`}>
            <td style={{ paddingRight: 16 }}>{r.type}</td>
            <td style={{ paddingRight: 16, ...mono }}>{r.name}</td>
            <td style={mono}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface MailFromSetupProps {
  domain: string;
  region?: string;
  load?: (domain: string) => Promise<MailFromState>;
  setup?: (input: { domain: string; subdomain?: string }) => Promise<SetupMailFromResult>;
}

export function MailFromSetup({ domain, region = "eu-west-1", load, setup }: MailFromSetupProps) {
  const loadStatus = load ?? defaultGetMailFromStatus;
  const runSetup = setup ?? defaultSetupMailFrom;

  const [state, setState] = useState<MailFromState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      setState(await loadStatus(domain));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  async function doSetup() {
    setBusy(true);
    setErr(null);
    try {
      const res = await runSetup({ domain });
      setState(res.state);
      setConfirming(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const alignment = mailFromAlignment(state);
  const mailFromDomain = state?.mailFromDomain ?? defaultMailFromDomain(domain);
  const previewRecords = mailFromDnsRecords(mailFromDomain, region);

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
      <h3 style={{ margin: "0 0 4px" }}>Improve deliverability — SPF alignment</h3>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 10px" }}>
        A custom <b>MAIL&nbsp;FROM</b> subdomain makes SPF align to <code style={mono}>{domain}</code> (not just
        Amazon's domain), which helps inbox placement at strict providers like Outlook/Hotmail.
      </p>

      {loading && <p style={{ fontSize: 14, color: "#666" }}>Checking MAIL FROM status…</p>}

      {!loading && (
        <>
          {alignment === "aligned" && (
            <div style={banner("#f0fdf4", "#bbf7d0", "#166534")}>
              ✅ <b>Custom MAIL FROM active</b> — <code style={mono}>{mailFromDomain}</code> is verified. SPF now aligns
              with your domain.
            </div>
          )}

          {alignment === "pending" && (
            <div style={banner("#eff6ff", "#bfdbfe", "#1e40af")}>
              ⏳ <b>DNS written — SES is verifying</b> <code style={mono}>{mailFromDomain}</code>. This can take a few
              minutes (DNS propagation). It keeps sending via the default Return-Path until verified, so nothing breaks.
              <div style={{ marginTop: 8 }}>
                <button onClick={() => void refresh()} disabled={busy} style={btn(busy)}>
                  Check verification status
                </button>
              </div>
            </div>
          )}

          {alignment === "failed" && (
            <div style={banner("#fef2f2", "#fecaca", "#b91c1c")}>
              ⚠️ <b>MAIL FROM verification failed</b> for <code style={mono}>{mailFromDomain}</code> — the MX/TXT records
              may be missing. You can re-apply them below.
            </div>
          )}

          {alignment === "not-configured" && (
            <div style={banner("#fffbeb", "#fde68a", "#92400e")}>
              Not configured yet. Mail currently passes DMARC on DKIM alone (SPF is not aligned to your domain).
            </div>
          )}

          {/* Offer setup when not configured or failed. */}
          {(alignment === "not-configured" || alignment === "failed") && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 13, color: "#444", margin: "0 0 4px" }}>
                Mailpoppy will point SES at <code style={mono}>{mailFromDomain}</code> and add these DNS records:
              </p>
              <RecordsTable records={previewRecords} />

              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={busy} style={{ ...btn(busy), marginTop: 10 }}>
                  Set up custom MAIL FROM
                </button>
              ) : (
                <div style={{ ...banner("#f8fafc", "#e2e8f0", "#334155"), marginTop: 10 }}>
                  This adds the DNS records above to <b>{domain}</b> and updates SES. Continue?
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button onClick={() => void doSetup()} disabled={busy} style={btn(busy)}>
                      {busy ? "Applying…" : "Apply DNS changes"}
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      style={{ background: "none", border: "none", color: "#777", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {err && <p style={{ color: "crimson", fontSize: 13 }}>{err}</p>}
    </div>
  );
}
