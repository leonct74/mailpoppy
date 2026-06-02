import { useState } from "react";
import { SetupWizard } from "./views/SetupWizard";
import { InboxView } from "./views/InboxView";

type Tab = "setup" | "inbox";

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid " + (active ? "#c4b5fd" : "#ddd"),
  background: active ? "#f5f3ff" : "white",
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
});

export function App() {
  const [tab, setTab] = useState<Tab>("setup");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>🌸 Mailpoppy</h1>
      <p style={{ color: "#666", marginTop: 0 }}>Host email for your own domains inside your own AWS account.</p>

      <nav style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={tabBtn(tab === "setup")} onClick={() => setTab("setup")}>
          Setup
        </button>
        <button style={tabBtn(tab === "inbox")} onClick={() => setTab("inbox")}>
          Inbox
        </button>
      </nav>

      {tab === "setup" ? <SetupWizard /> : <InboxView />}
    </main>
  );
}
