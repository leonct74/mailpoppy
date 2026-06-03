import { useEffect, useState } from "react";
import { formatBytes, usagePercent, usageLevel } from "@mailpoppy/core";
import { getMailboxStorage, setMailboxQuota, type MailboxStorageInfo } from "../lib/mailboxStorage";

// One row in the Mailboxes list: shows a mailbox's storage usage ("X of Y (Z%)")
// and lets the admin set or clear its storage limit. Fetches its own usage so
// the parent list stays simple.

const GB = 1024 ** 3;
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

export function MailboxStorageRow({ email, status, stackName }: { email: string; status?: string; stackName: string }) {
  const [info, setInfo] = useState<MailboxStorageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [gb, setGb] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(null);
    try {
      const i = await getMailboxStorage(stackName, email);
      setInfo(i);
      setGb(i.quotaBytes ? String(+(i.quotaBytes / GB).toFixed(2)) : "");
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, stackName]);

  async function save(clear: boolean) {
    setErr(null);
    const quotaBytes = clear ? null : Math.round(parseFloat(gb) * GB);
    if (!clear && (!quotaBytes || quotaBytes <= 0)) {
      setErr("Enter a positive number of GB.");
      return;
    }
    setBusy(true);
    try {
      await setMailboxQuota({ stackName, email, quotaBytes });
      setEditing(false);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const pct = info ? usagePercent(info.usedBytes, info.quotaBytes) : null;
  const level = info ? usageLevel(info.usedBytes, info.quotaBytes) : "ok";
  const color = level === "full" ? "#dc2626" : level === "warn" ? "#d97706" : "#7c3aed";

  return (
    <li style={{ marginBottom: 12, listStyle: "none" }}>
      <code style={mono}>{email}</code>
      {status && <span style={{ color: "#999", fontSize: 12 }}> · {status}</span>}
      {info && (
        <span style={{ color: "#666", fontSize: 12, marginLeft: 8 }}>
          {info.quotaBytes && pct !== null ? (
            <>
              · {formatBytes(info.usedBytes)} of {formatBytes(info.quotaBytes)} (<span style={{ color }}>{Math.round(pct)}%</span>)
            </>
          ) : (
            <>· {formatBytes(info.usedBytes)} used · no limit</>
          )}
        </span>
      )}
      {info?.quotaBytes && pct !== null && (
        <div style={{ height: 6, background: "#eee", borderRadius: 999, marginTop: 4, maxWidth: 340, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color }} />
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        {editing ? (
          <span style={{ fontSize: 13 }}>
            Limit{" "}
            <input
              aria-label={`Storage limit for ${email} in GB`}
              value={gb}
              onChange={(e) => setGb(e.target.value)}
              placeholder="e.g. 5"
              style={{ width: 70, padding: 4 }}
            />{" "}
            GB{" "}
            <button onClick={() => void save(false)} disabled={busy}>
              Save
            </button>{" "}
            <button onClick={() => void save(true)} disabled={busy}>
              Remove limit
            </button>{" "}
            <button onClick={() => setEditing(false)} disabled={busy} style={{ background: "none", border: "none", color: "#777", cursor: "pointer" }}>
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} style={{ fontSize: 12, cursor: "pointer" }}>
            {info?.quotaBytes ? "Change storage limit" : "Set storage limit"}
          </button>
        )}
      </div>
      {err && <div style={{ color: "#b91c1c", fontSize: 12 }}>{err}</div>}
    </li>
  );
}
