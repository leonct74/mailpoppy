import { useEffect, useState } from "react";
import { formatBytes, usagePercent, usageLevel } from "@mailpoppy/core";
import { getMailboxStorage, setMailboxQuota, type MailboxStorageInfo } from "../lib/mailboxStorage";
import {
  deleteMailbox as defaultDelete,
  resetMailboxPassword as defaultReset,
  type MailboxDeletion,
} from "../lib/mailbox";

// One row in the Mailboxes list: shows a mailbox's storage usage ("X of Y (Z%)")
// and lets the admin set or clear its storage limit, or permanently delete the
// mailbox. Fetches its own usage so the parent list stays simple. The load/save/
// delete calls are injectable so the row can be unit-tested without a sidecar.

const GB = 1024 ** 3;
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

// Deleting a mailbox is destructive + irreversible, so (per the teardown
// pattern) we require the admin to type this exact word to arm the button.
const CONFIRM_WORD = "delete";

export function MailboxStorageRow({
  email,
  status,
  stackName,
  loadStorage = getMailboxStorage,
  saveQuota = setMailboxQuota,
  del = defaultDelete,
  resetPw = defaultReset,
  onDeleted,
}: {
  email: string;
  status?: string;
  stackName: string;
  loadStorage?: (stackName: string, email: string) => Promise<MailboxStorageInfo>;
  saveQuota?: typeof setMailboxQuota;
  del?: (input: { email: string; stackName?: string }) => Promise<MailboxDeletion>;
  resetPw?: (input: { email: string; password: string; stackName?: string }) => Promise<{ ok: true; email: string }>;
  onDeleted?: (email: string) => void;
}) {
  const [info, setInfo] = useState<MailboxStorageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [gb, setGb] = useState("");
  const [busy, setBusy] = useState(false);

  // Delete flow
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  // Reset-password flow
  const [resetOpen, setResetOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  async function load() {
    setErr(null);
    try {
      const i = await loadStorage(stackName, email);
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
      await saveQuota({ stackName, email, quotaBytes });
      setEditing(false);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setDelErr(null);
    setDeleting(true);
    try {
      await del({ stackName, email });
      onDeleted?.(email);
      // Parent re-renders the list; no local state to reset on success.
    } catch (e) {
      setDelErr(String(e));
      setDeleting(false);
    }
  }

  async function doReset() {
    setPwErr(null);
    setPwDone(false);
    setPwBusy(true);
    try {
      await resetPw({ stackName, email, password: newPw });
      setPwDone(true);
      setNewPw("");
    } catch (e) {
      setPwErr(String(e));
    } finally {
      setPwBusy(false);
    }
  }

  const pct = info ? usagePercent(info.usedBytes, info.quotaBytes) : null;
  const level = info ? usageLevel(info.usedBytes, info.quotaBytes) : "ok";
  const color = level === "full" ? "#dc2626" : level === "warn" ? "#d97706" : "#7c3aed";
  const armed = confirmText.trim().toLowerCase() === CONFIRM_WORD;

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
          <>
            <button onClick={() => setEditing(true)} style={{ fontSize: 12, cursor: "pointer" }}>
              {info?.quotaBytes ? "Change storage limit" : "Set storage limit"}
            </button>{" "}
            {!resetOpen && (
              <button
                onClick={() => {
                  setResetOpen(true);
                  setNewPw("");
                  setPwErr(null);
                  setPwDone(false);
                }}
                style={{ fontSize: 12, cursor: "pointer" }}
              >
                Reset password
              </button>
            )}{" "}
            {!confirming && (
              <button
                onClick={() => {
                  setConfirming(true);
                  setConfirmText("");
                  setDelErr(null);
                }}
                style={{ fontSize: 12, cursor: "pointer", color: "#b91c1c", borderColor: "#fecaca" }}
              >
                Delete mailbox
              </button>
            )}
          </>
        )}
      </div>

      {resetOpen && (
        <div style={{ marginTop: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px", maxWidth: 520 }}>
          <div style={{ fontSize: 13, color: "#1e3a8a", lineHeight: 1.5 }}>
            Set a new sign-in password for <b>{email}</b>. Use this to recover a mailbox your organization owns (e.g. an
            employee who has left) — afterwards you, or the user, can sign in with the new password.{" "}
            <b>Only do this for mailboxes you’re authorised to access.</b>
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            New password{" "}
            <input
              aria-label={`New password for ${email}`}
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pwBusy}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{ width: 200, padding: 4, marginLeft: 4 }}
            />
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Min 8 characters, with upper &amp; lower case, a number and a symbol.
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => void doReset()}
              disabled={pwBusy || newPw.length < 8}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: pwBusy || newPw.length < 8 ? "#93c5fd" : "#2563eb",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: pwBusy || newPw.length < 8 ? "default" : "pointer",
              }}
            >
              {pwBusy ? "Setting…" : "Set password"}
            </button>
            <button
              onClick={() => {
                setResetOpen(false);
                setNewPw("");
                setPwErr(null);
                setPwDone(false);
              }}
              disabled={pwBusy}
              style={{ fontSize: 13, background: "none", border: "1px solid #ccc", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}
            >
              {pwDone ? "Close" : "Cancel"}
            </button>
            {pwDone && <span style={{ color: "#166534", fontSize: 13 }}>✅ Password updated.</span>}
          </div>
          {pwErr && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{pwErr}</div>}
        </div>
      )}

      {confirming && (
        <div
          style={{
            marginTop: 8,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "10px 12px",
            maxWidth: 520,
          }}
        >
          <div style={{ color: "#991b1b", fontSize: 13, lineHeight: 1.5 }}>
            ⚠️ <b>Permanently delete {email}?</b> This removes the sign-in user <b>and all of its stored mail</b>
            {info ? (
              <>
                {" "}
                ({info.messageCount} message{info.messageCount === 1 ? "" : "s"}, {formatBytes(info.usedBytes)})
              </>
            ) : null}
            . This <b>cannot be undone</b> — there is no trash or backup.
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Type{" "}
            <code style={{ ...mono, background: "#fff", padding: "1px 6px", borderRadius: 4, border: "1px solid #fecaca" }}>{CONFIRM_WORD}</code>{" "}
            to confirm:{" "}
            <input
              aria-label={`Type ${CONFIRM_WORD} to confirm deleting ${email}`}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={deleting}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{ width: 120, padding: 4, marginLeft: 4 }}
            />
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              onClick={() => void confirmDelete()}
              disabled={!armed || deleting}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: !armed || deleting ? "#fca5a5" : "#dc2626",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: !armed || deleting ? "default" : "pointer",
              }}
            >
              {deleting ? "Deleting…" : "Delete mailbox"}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
                setDelErr(null);
              }}
              disabled={deleting}
              style={{ fontSize: 13, background: "none", border: "1px solid #ccc", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
          {delErr && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 6 }}>{delErr}</div>}
        </div>
      )}

      {err && <div style={{ color: "#b91c1c", fontSize: 12 }}>{err}</div>}
    </li>
  );
}
