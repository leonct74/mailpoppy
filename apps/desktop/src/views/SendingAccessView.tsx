import { useEffect, useMemo, useState } from "react";
import {
  sendingAccessState,
  validateProductionAccessRequest,
  type SesAccountStatus,
  type ProductionAccessRequest,
  type MailType,
  type ContactLanguage,
} from "@mailpoppy/core";
import {
  getSesAccount as defaultGetSesAccount,
  requestProductionAccess as defaultRequestProductionAccess,
} from "../lib/sesAccount";

// "Sending access" panel for the setup wizard. Every AWS account starts SES in a
// "sandbox": you can only send to verified addresses, ~200 msgs/day. To run real
// mail the admin must request production access (a manual AWS review). This shows
// the current posture and submits the request in-app. load/submit are injectable
// so the view is unit-tested without a live sidecar.

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const input: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 6, font: "inherit" };
const btn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: disabled ? "#cbd5e1" : "#7c3aed",
  color: "#fff",
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});

const DEFAULT_USE_CASE =
  "We use Amazon SES to host email for our own domain — sending and receiving normal " +
  "business correspondence for our staff mailboxes. Recipients are our own contacts and " +
  "people who email us; we are not sending bulk or marketing email.";

export interface SendingAccessViewProps {
  /** Prefill the website URL (e.g. the domain being set up). */
  defaultWebsite?: string;
  load?: () => Promise<SesAccountStatus>;
  submit?: (req: ProductionAccessRequest) => Promise<SesAccountStatus>;
}

export function SendingAccessView({ defaultWebsite, load, submit }: SendingAccessViewProps) {
  const loadAccount = load ?? defaultGetSesAccount;
  const submitRequest = submit ?? defaultRequestProductionAccess;

  const [account, setAccount] = useState<SesAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Request form
  const [mailType, setMailType] = useState<MailType>("TRANSACTIONAL");
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsite ? `https://${defaultWebsite}` : "");
  const [useCase, setUseCase] = useState(DEFAULT_USE_CASE);
  const [language, setLanguage] = useState<ContactLanguage>("EN");
  const [extraEmails, setExtraEmails] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      setAccount(await loadAccount());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the prefill in sync if the domain becomes known after mount.
  useEffect(() => {
    if (defaultWebsite && !websiteUrl) setWebsiteUrl(`https://${defaultWebsite}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultWebsite]);

  const state = sendingAccessState(account);
  const req: ProductionAccessRequest = useMemo(
    () => ({
      mailType,
      websiteUrl,
      useCaseDescription: useCase,
      contactLanguage: language,
      additionalContactEmails: extraEmails
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    }),
    [mailType, websiteUrl, useCase, language, extraEmails],
  );
  const problems = useMemo(() => validateProductionAccessRequest(req), [req]);

  async function doSubmit() {
    setSubmitting(true);
    setErr(null);
    try {
      setAccount(await submitRequest(req));
      setConfirming(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = state === "sandbox" || state === "denied";

  return (
    <section aria-label="Sending access">
      <h2>Sending access (SES sandbox)</h2>

      {loading && <p style={{ fontSize: 14, color: "#666" }}>Checking your SES account…</p>}

      {!loading && account && (
        <>
          {state === "production" && (
            <div style={{ ...banner("#f0fdf4", "#bbf7d0", "#166534") }}>
              ✅ <b>Production access granted.</b> You can send email to any recipient.
            </div>
          )}
          {state === "pending" && (
            <div style={{ ...banner("#eff6ff", "#bfdbfe", "#1e40af") }}>
              ⏳ <b>Production access requested.</b> AWS is reviewing your request — this usually takes under 24 hours.
              You'll get an email at your AWS account's address when it's decided. Until then you can only send to
              verified addresses.
            </div>
          )}
          {state === "denied" && (
            <div style={{ ...banner("#fef2f2", "#fecaca", "#b91c1c") }}>
              ⚠️ <b>AWS did not approve the request.</b> Check the email AWS sent for the reason, adjust the details
              below, and submit again.
            </div>
          )}
          {state === "disabled" && (
            <div style={{ ...banner("#fef2f2", "#fecaca", "#b91c1c") }}>
              ⛔ <b>Sending is paused on your account</b> (enforcement status{" "}
              <code style={mono}>{account.enforcementStatus ?? "unknown"}</code>). Resolve this in the AWS SES console
              before requesting production access.
            </div>
          )}
          {state === "sandbox" && (
            <div style={{ ...banner("#fffbeb", "#fde68a", "#92400e") }}>
              🟡 <b>Your SES account is in the sandbox.</b> You can send only to <i>verified</i> addresses, with a small
              daily cap. To send real mail to anyone, request production access below.
            </div>
          )}

          {account.sendQuota && (
            <p style={{ fontSize: 13, color: "#666" }}>
              Daily sending: <b>{account.sendQuota.sentLast24Hours}</b> of{" "}
              <b>{account.sendQuota.max24Hour.toLocaleString()}</b> in the last 24h · max{" "}
              <b>{account.sendQuota.maxSendRate}</b>/sec
            </p>
          )}
        </>
      )}

      {showForm && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
            AWS reviews this manually (usually within 24h). Be specific — vague descriptions get rejected.
          </p>

          <fieldset style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, margin: 0 }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Mail type</span>
              <br />
              <label style={{ fontSize: 14, marginRight: 16 }}>
                <input
                  type="radio"
                  name="mailType"
                  checked={mailType === "TRANSACTIONAL"}
                  onChange={() => setMailType("TRANSACTIONAL")}
                />{" "}
                Transactional <span style={{ color: "#999", fontSize: 12 }}>(your own correspondence — pick this)</span>
              </label>
              <label style={{ fontSize: 14 }}>
                <input
                  type="radio"
                  name="mailType"
                  checked={mailType === "MARKETING"}
                  onChange={() => setMailType("MARKETING")}
                />{" "}
                Marketing
              </label>
            </div>

            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Website URL
              <br />
              <input
                aria-label="Website URL"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value.trim())}
                placeholder="https://yourdomain.com"
                style={{ ...input, width: 320, fontWeight: 400 }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>

            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                How you'll use email
                <br />
                <textarea
                  aria-label="Use case description"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  rows={4}
                  style={{ ...input, width: "100%", fontWeight: 400, resize: "vertical" }}
                />
              </label>
              <span style={{ fontSize: 12, color: "#999" }}>{useCase.trim().length} characters</span>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Contact language
                <br />
                <select
                  aria-label="Contact language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as ContactLanguage)}
                  style={{ ...input, fontWeight: 400 }}
                >
                  <option value="EN">English</option>
                  <option value="JA">Japanese</option>
                </select>
              </label>
              <label style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 220 }}>
                Extra contact emails <span style={{ color: "#999", fontWeight: 400 }}>(optional, comma-separated)</span>
                <br />
                <input
                  aria-label="Additional contact emails"
                  value={extraEmails}
                  onChange={(e) => setExtraEmails(e.target.value)}
                  placeholder="ops@yourdomain.com"
                  style={{ ...input, width: "100%", fontWeight: 400 }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            </div>
          </fieldset>

          {problems.length > 0 && (
            <ul style={{ color: "#b45309", fontSize: 13, marginTop: 8 }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={problems.length > 0 || submitting}
              style={{ ...btn(problems.length > 0 || submitting), marginTop: 10 }}
            >
              Request production access
            </button>
          ) : (
            <div style={{ ...banner("#f8fafc", "#e2e8f0", "#334155"), marginTop: 10 }}>
              This submits a request to <b>AWS</b> (it opens a Support case AWS reviews). Continue?
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button onClick={() => void doSubmit()} disabled={submitting} style={btn(submitting)}>
                  {submitting ? "Submitting…" : "Submit to AWS"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={submitting}
                  style={{ background: "none", border: "none", color: "#777", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && <p style={{ color: "crimson", fontSize: 13 }}>{err}</p>}
    </section>
  );
}

function banner(bg: string, border: string, color: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 8, padding: "10px 12px", fontSize: 14 };
}
