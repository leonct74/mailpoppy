// A plain-language summary of how Mailpoppy protects a domain's email — the
// kind of thing an admin evaluating Mailpoppy against WorkMail / a hosted
// provider wants to see up front. Everything listed is implemented in the
// deployed stack (see infra/lib/mail-stack.ts) except the clearly-marked
// optional add-on.

interface Feature {
  icon: string;
  title: string;
  detail: string;
  status: "on" | "optional";
}

const FEATURES: Feature[] = [
  {
    icon: "🏠",
    title: "Your data never leaves your AWS account",
    detail:
      "Mailpoppy deploys the entire mail backend into your own AWS account. Your messages and attachments live in your S3 bucket and DynamoDB — no third party (including us) can read them.",
    status: "on",
  },
  {
    icon: "🔒",
    title: "Encrypted at rest",
    detail:
      "Mail in S3 is server-side encrypted (AES-256, SSE-S3); DynamoDB is encrypted at rest. The mail bucket blocks all public access.",
    status: "on",
  },
  {
    icon: "🔐",
    title: "Encrypted in transit",
    detail:
      "The S3 bucket enforces TLS (HTTPS-only); the mail API is HTTPS-only. Nothing is served over plaintext.",
    status: "on",
  },
  {
    icon: "🛡",
    title: "Virus & spam scanning on every inbound message",
    detail:
      "AWS SES scans each incoming email (attachments included). A message that fails the virus check is quarantined to Junk and never reaches your inbox; spam is routed to Junk. Each message shows its scan result.",
    status: "on",
  },
  {
    icon: "✅",
    title: "Sender authentication (SPF · DKIM · DMARC)",
    detail:
      "Inbound mail is checked against SPF, DKIM and DMARC, and the verdicts are shown per message. Outbound mail is DKIM-signed for your domain so it lands in inboxes, not spam.",
    status: "on",
  },
  {
    icon: "👤",
    title: "Per-mailbox isolation — no AWS keys on the mail path",
    detail:
      "Reading or sending mail requires a Cognito sign-in (JWT). The API derives which mailbox you may touch purely from the verified token, so one mailbox can never access another's mail. AWS credentials are used only by the admin app for provisioning, never for mail access.",
    status: "on",
  },
  {
    icon: "🧰",
    title: "Least-privilege & no public storage",
    detail:
      "Each function gets only the permissions it needs. Attachments are downloaded through short-lived (5-minute) signed links — the bucket itself is never public.",
    status: "on",
  },
  {
    icon: "🔬",
    title: "Deep malware scanning of stored files",
    detail:
      "Optional add-on (recommended): GuardDuty Malware Protection scans every stored attachment with a dedicated, signature-updated engine and blocks downloads of anything it flags — defense-in-depth on top of SES's scan. Enable it in Setup (small AWS usage cost; a personal mailbox is typically covered by the AWS free tier).",
    status: "optional",
  },
];

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};
const sheet: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  maxWidth: 620,
  width: "100%",
  maxHeight: "85vh",
  overflowY: "auto",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
};
const badge = (s: Feature["status"]): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  padding: "1px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  background: s === "on" ? "#f0fdf4" : "#fff7ed",
  color: s === "on" ? "#15803d" : "#b45309",
  border: `1px solid ${s === "on" ? "#bbf7d0" : "#fed7aa"}`,
});

export function SecurityInfo({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Email security" style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>🔒 How your email is protected</h2>
          <button onClick={onClose} style={{ cursor: "pointer", border: "none", background: "none", fontSize: 20, color: "#777" }} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={{ color: "#666", fontSize: 13, marginTop: 6 }}>
          Mailpoppy hosts your domain's email entirely inside your own AWS account. These protections are in place:
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {FEATURES.map((f) => (
            <li key={f.title} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 20, lineHeight: "24px" }} aria-hidden>
                {f.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>{f.title}</strong>
                  <span style={badge(f.status)}>{f.status === "on" ? "Active" : "Recommended"}</span>
                </div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>{f.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
