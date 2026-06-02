import { useState } from "react";
import type { DeploymentConfig } from "../lib/deploymentConfig";

// Enter the four CloudFormation Outputs of a deployed Mailpoppy backend. The
// admin gets these from the Setup wizard's deploy step (or the AWS console).

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 20, marginTop: 16, maxWidth: 560 };
const field: React.CSSProperties = { width: "100%", padding: 8, marginBottom: 10, fontFamily: "ui-monospace, monospace" };
const label: React.CSSProperties = { display: "block", fontSize: 13, color: "#555", marginBottom: 2 };

export function ConnectView({
  initial,
  onSave,
  onCancel,
}: {
  initial?: DeploymentConfig | null;
  onSave: (c: DeploymentConfig) => void;
  onCancel?: () => void;
}) {
  const [apiBaseUrl, setApiBaseUrl] = useState(initial?.apiBaseUrl ?? "");
  const [userPoolId, setUserPoolId] = useState(initial?.userPoolId ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [region, setRegion] = useState(initial?.region ?? "eu-west-1");
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!apiBaseUrl || !userPoolId || !clientId || !region) {
      setErr("All four values are required.");
      return;
    }
    onSave({ apiBaseUrl: apiBaseUrl.trim().replace(/\/$/, ""), userPoolId: userPoolId.trim(), clientId: clientId.trim(), region: region.trim() });
  }

  return (
    <div style={box}>
      <h3 style={{ marginTop: 0 }}>Connect to your deployment</h3>
      <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>
        Paste the outputs from your Mailpoppy CloudFormation stack.
      </p>

      <label style={label}>API base URL (ApiBaseUrl)</label>
      <input style={field} value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://abc123.execute-api.eu-west-1.amazonaws.com" />

      <label style={label}>User Pool ID (UserPoolId)</label>
      <input style={field} value={userPoolId} onChange={(e) => setUserPoolId(e.target.value)} placeholder="eu-west-1_xxxxxxxxx" />

      <label style={label}>App client ID (UserPoolClientId)</label>
      <input style={field} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx" />

      <label style={label}>Region (DeployRegion)</label>
      <input style={field} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eu-west-1" />

      {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} style={{ cursor: "pointer", padding: "8px 14px" }}>Save & continue</button>
        {onCancel && <button onClick={onCancel} style={{ cursor: "pointer", padding: "8px 14px" }}>Cancel</button>}
      </div>
    </div>
  );
}
