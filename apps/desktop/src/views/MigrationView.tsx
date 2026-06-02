import { useState } from "react";
import {
  testImap as defaultTest,
  runMigration as defaultRun,
  type ImapFolderInfo,
  type MigrateSummary,
} from "../lib/migration";

// Phase 4 — "Bring your old mail across." Connects to the user's existing
// WorkMail / IMAP account (credentials stay on this machine, in the sidecar),
// previews the folders, and imports the selected ones into the deployed
// Mailpoppy backend. Imported mail appears in the normal Inbox afterwards.

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 12, padding: 16, marginTop: 16 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", fontSize: 14 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, color: "#666", padding: "4px 8px", borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f3f3f3" };
const primary: React.CSSProperties = { padding: "9px 16px", borderRadius: 8, border: "1px solid #7c3aed", background: "#7c3aed", color: "white", cursor: "pointer", fontWeight: 600 };
const ghost: React.CSSProperties = { padding: "9px 16px", borderRadius: 8, border: "1px solid #ccc", background: "white", cursor: "pointer" };

export function MigrationView({
  test = defaultTest,
  run = defaultRun,
}: {
  test?: typeof defaultTest;
  run?: typeof defaultRun;
}) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [stackName, setStackName] = useState("MailpoppyMailStack");
  const [dryRun, setDryRun] = useState(false);

  const [folders, setFolders] = useState<ImapFolderInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<MigrateSummary | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "run">("");
  const [error, setError] = useState<string | null>(null);

  function source() {
    return { host, port: Number(port) || undefined, secure, user, password };
  }

  async function onTest() {
    setBusy("test");
    setError(null);
    setSummary(null);
    try {
      const res = await test(source());
      setFolders(res.folders);
      // Pre-select non-empty folders.
      setSelected(new Set(res.folders.filter((f) => f.messages > 0).map((f) => f.path)));
    } catch (e) {
      setFolders(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onRun() {
    setBusy("run");
    setError(null);
    try {
      const res = await run({
        source: source(),
        mailbox,
        stackName,
        folders: [...selected],
        dryRun,
      });
      setSummary(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const canTest = host && user && password && busy === "";
  const canRun = folders && selected.size > 0 && mailbox && busy === "";

  return (
    <section>
      <h2 style={{ margin: 0 }}>Bring your old mail across</h2>
      <p style={{ color: "#666", margin: "4px 0 0", fontSize: 13 }}>
        Import existing mail from AWS WorkMail (or any IMAP server) into your Mailpoppy mailbox before the
        source is shut down. Your IMAP password stays on this machine — it is sent only to the local
        provisioning helper, never to us.
      </p>

      <div style={box}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={field}>
            IMAP host
            <input aria-label="IMAP host" style={input} value={host} placeholder="imap.mail.us-east-1.awsapps.com" onChange={(e) => setHost(e.target.value)} />
          </label>
          <label style={field}>
            Port
            <input aria-label="IMAP port" style={input} value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
          <label style={field}>
            Username
            <input aria-label="IMAP username" style={input} value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label style={field}>
            Password
            <input aria-label="IMAP password" type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label style={field}>
            Destination mailbox
            <input aria-label="Destination mailbox" style={input} value={mailbox} placeholder="you@yourdomain.com" onChange={(e) => setMailbox(e.target.value)} />
          </label>
          <label style={field}>
            Stack name
            <input aria-label="Stack name" style={input} value={stackName} onChange={(e) => setStackName(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
          <label style={{ fontSize: 13 }}>
            <input aria-label="Use TLS" type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> Implicit TLS (993)
          </label>
          <label style={{ fontSize: 13 }}>
            <input aria-label="Preview only" type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Preview only (count, don’t import)
          </label>
          <button style={canTest ? primary : { ...primary, opacity: 0.5, cursor: "default" }} disabled={!canTest} onClick={() => void onTest()}>
            {busy === "test" ? "Connecting…" : "Test connection"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...box, borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" }}>{error}</div>
      )}

      {folders && (
        <div style={box}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Folders on {host}</strong>
            <button style={canRun ? primary : { ...primary, opacity: 0.5, cursor: "default" }} disabled={!canRun} onClick={() => void onRun()}>
              {busy === "run" ? "Importing…" : dryRun ? "Preview selected" : `Import ${selected.size} folder${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
          {folders.length === 0 ? (
            <p style={{ color: "#666", fontSize: 13 }}>No folders found.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={th}>Import</th>
                  <th style={th}>IMAP folder</th>
                  <th style={th}>→ Mailpoppy folder</th>
                  <th style={th}>Messages</th>
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.path}>
                    <td style={td}>
                      <input
                        aria-label={`Include ${f.path}`}
                        type="checkbox"
                        checked={selected.has(f.path)}
                        onChange={() => toggle(f.path)}
                      />
                    </td>
                    <td style={td}>{f.path}</td>
                    <td style={{ ...td, color: "#555" }}>{f.mappedFolder}</td>
                    <td style={td}>{f.messages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {summary && (
        <div style={{ ...box, borderColor: "#bbf7d0", background: "#f0fdf4" }}>
          <strong>{summary.dryRun ? "Preview" : "Import complete"}</strong>
          <p style={{ margin: "6px 0", fontSize: 14 }}>
            {summary.dryRun
              ? `${summary.totalImported} messages would be imported into ${summary.mailbox}.`
              : `Imported ${summary.totalImported} messages into ${summary.mailbox} (${summary.totalSkipped} skipped). They’re in your Inbox now.`}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>IMAP folder</th>
                <th style={th}>→ Mailpoppy folder</th>
                <th style={th}>{summary.dryRun ? "Would import" : "Imported"}</th>
                <th style={th}>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {summary.folders.map((r) => (
                <tr key={r.path}>
                  <td style={td}>{r.path}</td>
                  <td style={{ ...td, color: "#555" }}>{r.mappedFolder}</td>
                  <td style={td}>{r.imported}</td>
                  <td style={td}>{r.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
