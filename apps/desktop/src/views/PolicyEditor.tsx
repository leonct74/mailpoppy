import { useEffect, useState } from "react";
import { isValidListEntry, type SpamPolicy } from "@mailpoppy/core";
import { getSpamPolicy as defaultGet, setSpamPolicy as defaultSet } from "../lib/policy";

// "Mail rules" editor for the wizard: per-verdict actions (spam / auth-fail /
// virus → junk/tag/reject) + sender allow/block lists. The inbound-processor
// Lambda enforces these on incoming mail (block-list → allow-list → virus → spam
// → auth → clean). load/save are injectable so the view is unit-tested.

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };
const sel: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 6, font: "inherit" };
const ta: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 6, font: "inherit", resize: "vertical" };
const btn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: disabled ? "#cbd5e1" : "#7c3aed",
  color: "#fff",
  fontWeight: 600,
  cursor: disabled ? "default" : "pointer",
});

const SPAM_OPTS = [
  { v: "junk", label: "Move to Junk" },
  { v: "tag", label: "Keep in Inbox (tagged)" },
  { v: "reject", label: "Reject (don't deliver)" },
] as const;
const AUTH_OPTS = [
  { v: "junk", label: "Move to Junk" },
  { v: "tag", label: "Keep in Inbox (tagged)" },
  { v: "reject", label: "Reject (don't deliver)" },
  { v: "allow", label: "Allow (treat as normal)" },
] as const;
const VIRUS_OPTS = [
  { v: "quarantine", label: "Quarantine in Junk" },
  { v: "reject", label: "Reject (don't deliver)" },
] as const;

function parseList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface PolicyEditorProps {
  stackName: string;
  load?: (stackName: string) => Promise<SpamPolicy>;
  save?: (input: { stackName: string; policy: SpamPolicy }) => Promise<{ ok: true; policy: SpamPolicy }>;
}

export function PolicyEditor({ stackName, load, save }: PolicyEditorProps) {
  const loadPolicy = load ?? defaultGet;
  const savePolicy = save ?? defaultSet;

  const [onVirus, setOnVirus] = useState<SpamPolicy["onVirus"]>("quarantine");
  const [onSpam, setOnSpam] = useState<SpamPolicy["onSpam"]>("junk");
  const [onAuthFail, setOnAuthFail] = useState<SpamPolicy["onAuthFail"]>("junk");
  const [allowText, setAllowText] = useState("");
  const [blockText, setBlockText] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function applyPolicy(p: SpamPolicy) {
    setOnVirus(p.onVirus);
    setOnSpam(p.onSpam);
    setOnAuthFail(p.onAuthFail);
    setAllowText(p.allowList.join("\n"));
    setBlockText(p.blockList.join("\n"));
  }

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      applyPolicy(await loadPolicy(stackName));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackName]);

  const allowList = parseList(allowText);
  const blockList = parseList(blockText);
  const invalid = [...allowList, ...blockList].filter((e) => !isValidListEntry(e));

  async function onSave() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await savePolicy({ stackName, policy: { onVirus, onSpam, onAuthFail, allowList, blockList } });
      applyPolicy(res.policy); // reflect server-normalized (deduped/lowercased) lists
      setSaved(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Mail rules">
      <h2>Mail rules — spam &amp; allow/block</h2>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        How incoming mail is handled. Order: <b>block list</b> → <b>allow list</b> → virus → spam → failed
        authentication → clean. Changes apply to <b>newly received</b> mail.
      </p>

      {loading && <p style={{ fontSize: 14, color: "#666" }}>Loading mail rules…</p>}

      {!loading && (
        <>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Spam → <br />
              <select aria-label="Spam action" value={onSpam} onChange={(e) => setOnSpam(e.target.value as SpamPolicy["onSpam"])} style={sel}>
                {SPAM_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Failed SPF/DKIM/DMARC → <br />
              <select aria-label="Auth-fail action" value={onAuthFail} onChange={(e) => setOnAuthFail(e.target.value as SpamPolicy["onAuthFail"])} style={sel}>
                {AUTH_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Virus → <br />
              <select aria-label="Virus action" value={onVirus} onChange={(e) => setOnVirus(e.target.value as SpamPolicy["onVirus"])} style={sel}>
                {VIRUS_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
              <div style={{ fontWeight: 400, color: "#999", fontSize: 11 }}>A virus is never delivered to the inbox.</div>
            </label>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 240 }}>
              Allow list <span style={{ fontWeight: 400, color: "#999" }}>(always inbox, skips spam/auth checks)</span>
              <textarea aria-label="Allow list" value={allowText} onChange={(e) => setAllowText(e.target.value)} rows={4} style={ta} placeholder={"boss@partner.com\npartner.com"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 240 }}>
              Block list <span style={{ fontWeight: 400, color: "#999" }}>(rejected, never stored)</span>
              <textarea aria-label="Block list" value={blockText} onChange={(e) => setBlockText(e.target.value)} rows={4} style={ta} placeholder={"spammer@bad.com\nbad.com"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
          </div>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>
            One entry per line — an address (<code style={mono}>a@b.com</code>), a domain (<code style={mono}>b.com</code>), or{" "}
            <code style={mono}>@b.com</code>.
          </p>

          {invalid.length > 0 && (
            <div style={{ color: "#b45309", fontSize: 13, marginTop: 8 }}>
              These entries don't look like an address or domain and won't match anything:{" "}
              {invalid.map((e) => (
                <code key={e} style={{ ...mono, marginRight: 8 }}>{e}</code>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => void onSave()} disabled={saving} style={btn(saving)}>
              {saving ? "Saving…" : "Save mail rules"}
            </button>
            {saved && <span style={{ color: "#166534", fontSize: 13 }}>✅ Saved — applies to new mail.</span>}
          </div>
        </>
      )}

      {err && <p style={{ color: "crimson", fontSize: 13 }}>{err}</p>}
    </section>
  );
}
