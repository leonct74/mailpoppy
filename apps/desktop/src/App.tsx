import { useEffect, useMemo, useState } from "react";
import { SetupWizard } from "./views/SetupWizard";
import { InboxView } from "./views/InboxView";
import { ResourcesView } from "./views/ResourcesView";
import { ConnectView } from "./views/ConnectView";
import { LoginView } from "./views/LoginView";
import { CognitoAuth } from "./lib/auth";
import { makeMailClient } from "./lib/mailClient";
import {
  loadDeploymentConfig,
  saveDeploymentConfig,
  clearDeploymentConfig,
  type DeploymentConfig,
} from "./lib/deploymentConfig";

type Tab = "setup" | "inbox" | "resources";

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid " + (active ? "#c4b5fd" : "#ddd"),
  background: active ? "#f5f3ff" : "white",
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
});

const liveBar: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  fontSize: 13,
  color: "#555",
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 8,
  padding: "6px 12px",
  marginTop: 12,
};
const linkBtn: React.CSSProperties = { cursor: "pointer", background: "none", border: "none", color: "#7c3aed", textDecoration: "underline", padding: 0 };

/**
 * Mailbox tab state machine:
 *   no config            → demo inbox (offline) + "Connect a deployment"
 *   config, signed out   → login
 *   config, signed in    → live inbox (Cognito JWT → API Gateway)
 */
function InboxTab() {
  const [config, setConfig] = useState<DeploymentConfig | null>(() => loadDeploymentConfig());
  const [editingConfig, setEditingConfig] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const auth = useMemo(() => (config ? new CognitoAuth(config) : null), [config]);
  const liveClient = useMemo(
    () => (config && auth ? makeMailClient({ apiBaseUrl: config.apiBaseUrl, getToken: () => auth.getToken() }) : null),
    [config, auth],
  );

  // Restore an existing persisted Cognito session when the config/auth changes.
  useEffect(() => {
    setSignedIn(auth?.hasSession() ?? false);
  }, [auth]);

  if (editingConfig) {
    return (
      <ConnectView
        initial={config}
        onSave={(c) => {
          saveDeploymentConfig(c);
          setConfig(c);
          setSignedIn(false);
          setEditingConfig(false);
        }}
        onCancel={() => setEditingConfig(false)}
      />
    );
  }

  if (!config) {
    return <InboxView demo onConnect={() => setEditingConfig(true)} />;
  }

  if (auth && !signedIn) {
    return <LoginView auth={auth} onSignedIn={() => setSignedIn(true)} onReconfigure={() => setEditingConfig(true)} />;
  }

  return (
    <>
      <div style={liveBar}>
        <span>✅ Connected to <code>{config.apiBaseUrl}</code></span>
        <button style={linkBtn} onClick={() => { auth?.signOut(); setSignedIn(false); }}>Sign out</button>
        <button style={linkBtn} onClick={() => setEditingConfig(true)}>Change deployment</button>
        <button style={linkBtn} onClick={() => { clearDeploymentConfig(); setConfig(null); setSignedIn(false); }}>Disconnect</button>
      </div>
      {liveClient && <InboxView client={liveClient} />}
    </>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("setup");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>🌸 Mailpoppy</h1>
      <p style={{ color: "#666", marginTop: 0 }}>Host email for your own domains inside your own AWS account.</p>

      <nav style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={tabBtn(tab === "setup")} onClick={() => setTab("setup")}>Setup</button>
        <button style={tabBtn(tab === "inbox")} onClick={() => setTab("inbox")}>Inbox</button>
        <button style={tabBtn(tab === "resources")} onClick={() => setTab("resources")}>AWS Resources</button>
      </nav>

      {tab === "setup" && <SetupWizard />}
      {tab === "inbox" && <InboxTab />}
      {tab === "resources" && <ResourcesView />}
    </main>
  );
}
