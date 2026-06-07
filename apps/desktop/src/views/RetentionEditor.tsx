import { useEffect, useState } from "react";
import type { RetentionSettings } from "@mailpoppy/core";
import { getRetention as defaultGet, setRetention as defaultSet } from "../lib/retention";

// "How long mail is kept" editor. AWS never auto-deletes mail, so the safe default
// is keep-indefinitely (+ auto-purge Trash). A delete-after window is opt-in and
// clearly flagged as permanent, because some jurisdictions require data
// minimisation while others require minimum retention — it's the admin's call.

const input: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 6, font: "inherit", width: 80 };
const btn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: disabled ? "#cbd5e1" : "#7c3aed",
  color: "#fff",
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});

export interface RetentionEditorProps {
  stackName: string;
  load?: (stackName: string) => Promise<RetentionSettings>;
  save?: (input: { stackName: string; retention: RetentionSettings }) => Promise<{ ok: true; retention: RetentionSettings }>;
}

export function RetentionEditor({ stackName, load, save }: RetentionEditorProps) {
  const loadRetention = load ?? defaultGet;
  const saveRetention = save ?? defaultSet;

  const [trashPurgeDays, setTrashPurgeDays] = useState("30");
  const [keepForever, setKeepForever] = useState(true);
  const [retentionDays, setRetentionDays] = useState("365");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function apply(r: RetentionSettings) {
    setTrashPurgeDays(String(r.trashPurgeDays));
    setKeepForever(r.retentionDays === null);
    if (r.retentionDays !== null) setRetentionDays(String(r.retentionDays));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        apply(await loadRetention(stackName));
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackName]);

  async function onSave() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const retention: RetentionSettings = {
        trashPurgeDays: Math.max(1, Math.floor(Number(trashPurgeDays) || 30)),
        retentionDays: keepForever ? null : Math.max(1, Math.floor(Number(retentionDays) || 0)) || null,
      };
      const res = await saveRetention({ stackName, retention });
      apply(res.retention);
      setSaved(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Retention">
      <h2>Retention — how long mail is kept</h2>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        AWS never deletes mail on its own — Mailpoppy keeps it until you say otherwise. Some rules require a{" "}
        <i>minimum</i> retention, others a <i>maximum</i> — so this is your call.
      </p>

      {loading && <p style={{ fontSize: 14, color: "#666" }}>Loading retention…</p>}

      {!loading && (
        <>
          <div style={{ fontSize: 14, marginBottom: 12 }}>
            Empty the Trash automatically after{" "}
            <input aria-label="Trash purge days" value={trashPurgeDays} onChange={(e) => setTrashPurgeDays(e.target.value)} style={input} /> days.
          </div>

          <div style={{ fontSize: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Keep mail for how long?</div>
            <label style={{ display: "block", marginBottom: 4 }}>
              <input type="radio" name="ret" aria-label="Keep mail indefinitely" checked={keepForever} onChange={() => setKeepForever(true)} /> Keep
              indefinitely <span style={{ color: "#999", fontSize: 12 }}>(recommended — never auto-deleted)</span>
            </label>
            <label style={{ display: "block" }}>
              <input type="radio" name="ret" aria-label="Delete mail after a set time" checked={!keepForever} onChange={() => setKeepForever(false)} /> Delete mail
              older than{" "}
              <input
                aria-label="Retention days"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                disabled={keepForever}
                style={{ ...input, opacity: keepForever ? 0.5 : 1 }}
              />{" "}
              days
            </label>
          </div>

          {!keepForever && (
            <div style={{ marginTop: 10, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              ⚠️ This <b>permanently deletes</b> any mail older than {Math.max(1, Math.floor(Number(retentionDays) || 0)) || "—"} days, in
              every folder, on the next daily cleanup. Make sure this matches the rules that apply to your users.
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => void onSave()} disabled={saving} style={btn(saving)}>
              {saving ? "Saving…" : "Save retention"}
            </button>
            {saved && <span style={{ color: "#166534", fontSize: 13 }}>✅ Saved.</span>}
          </div>
        </>
      )}

      {err && <p style={{ color: "crimson", fontSize: 13 }}>{err}</p>}
    </section>
  );
}
