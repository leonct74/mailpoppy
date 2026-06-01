import { SetupWizard } from "./views/SetupWizard";

export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>🌸 Mailpoppy</h1>
      <p style={{ color: "#666" }}>
        Host email for your own domains inside your own AWS account.
      </p>
      <SetupWizard />
    </main>
  );
}
