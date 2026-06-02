import { useEffect, useMemo, useState } from "react";
import type { MessageMeta, Folder } from "@mailpoppy/core";
import { makeMailClient, type MailClient } from "../lib/mailClient";
import { parseBody, sanitizeHtml, type ParsedBody } from "../lib/mailBody";
import { buildReply, type ComposeInit, type ReplyMode } from "../lib/reply";
import { renderMarkdown } from "../lib/compose";

// Phase 2 mailbox UI: browse folders, read a message (sanitized HTML, remote
// images blocked by default), toggle read/star, move to trash / restore, and
// compose → send. Talks to a
// MailClient (the shared api-client against a deployed backend, or the demo
// client offline) — so this view is identical for desktop and, later, mobile.

const FOLDERS: Folder[] = ["inbox", "sent", "drafts", "trash", "junk"];
const FOLDER_LABEL: Record<string, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  trash: "Trash",
  junk: "Junk",
};

const wrap: React.CSSProperties = { display: "flex", gap: 16, marginTop: 16, alignItems: "flex-start" };
const rail: React.CSSProperties = { width: 130, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 };
const listCol: React.CSSProperties = { flex: 1, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden", minWidth: 0 };
const detailCol: React.CSSProperties = { flex: 1.4, border: "1px solid #ddd", borderRadius: 12, padding: 16, minWidth: 0 };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13 };
const railBtn = (active: boolean): React.CSSProperties => ({
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid " + (active ? "#c4b5fd" : "transparent"),
  background: active ? "#f5f3ff" : "transparent",
  cursor: "pointer",
  fontWeight: active ? 600 : 400,
});

function fromLabel(m: MessageMeta): string {
  return m.from.name || m.from.address || "(unknown)";
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function InboxView({
  client,
  demo,
  onConnect,
}: {
  client?: MailClient;
  demo?: boolean;
  onConnect?: () => void;
}) {
  const mail = useMemo<MailClient>(() => client ?? makeMailClient(), [client]);

  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MessageMeta[]>([]);
  const [selected, setSelected] = useState<MessageMeta | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBody | null>(null);
  const [allowImages, setAllowImages] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeInit, setComposeInit] = useState<ComposeInit | null>(null);

  function startReply(mode: ReplyMode) {
    if (!selected) return;
    setComposeInit(buildReply(selected, mode, { self: selected.mailbox, quotedBody: parsed?.text ?? selected.snippet }));
  }

  async function refresh(f: Folder = folder) {
    setLoading(true);
    setError(null);
    try {
      const res = await mail.list({ folder: f, limit: 100 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever the folder changes.
  useEffect(() => {
    setSelected(null);
    setRaw(null);
    setParsed(null);
    void refresh(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, mail]);

  async function open(m: MessageMeta) {
    setSelected(m);
    setRaw(null);
    setParsed(null);
    setAllowImages(false); // re-block remote content for each newly opened message
    setShowRaw(false);

    let eml: string;
    try {
      ({ eml } = await mail.getRaw(m.messageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setRaw(eml);

    // Mark read immediately — independent of (and not blocked by) body parsing.
    if (m.flags.unread) {
      try {
        await mail.setFlags(m.messageId, { unread: false });
        setItems((prev) => prev.map((x) => (x.messageId === m.messageId ? { ...x, flags: { ...x.flags, unread: false } } : x)));
        setSelected((s) => (s ? { ...s, flags: { ...s.flags, unread: false } } : s));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    // Body parsing is best-effort: a parse failure just falls back to the raw view.
    try {
      setParsed(await parseBody(eml));
    } catch {
      setParsed(null);
    }
  }

  async function downloadAttachment(messageId: string, index: number) {
    try {
      const { url } = await mail.getAttachmentUrl(messageId, index);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleRead(m: MessageMeta) {
    const next = !m.flags.unread;
    await mail.setFlags(m.messageId, { unread: next });
    setItems((prev) => prev.map((x) => (x.messageId === m.messageId ? { ...x, flags: { ...x.flags, unread: next } } : x)));
  }

  async function toggleStar(m: MessageMeta) {
    const next = !m.flags.starred;
    await mail.setFlags(m.messageId, { starred: next });
    setItems((prev) => prev.map((x) => (x.messageId === m.messageId ? { ...x, flags: { ...x.flags, starred: next } } : x)));
  }

  async function moveTo(m: MessageMeta, dest: Folder) {
    await mail.move(m.messageId, dest);
    setItems((prev) => prev.filter((x) => x.messageId !== m.messageId));
    if (selected?.messageId === m.messageId) {
      setSelected(null);
      setRaw(null);
    }
  }

  const unreadCount = items.filter((m) => m.flags.unread).length;

  return (
    <section>
      {demo && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px", marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13 }}>
            🧪 <strong>Demo data</strong> — not connected to a live mailbox.
          </span>
          {onConnect && (
            <button onClick={onConnect} style={{ cursor: "pointer", padding: "6px 10px" }}>
              Connect a deployment
            </button>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Mailbox</h2>
        <button onClick={() => setComposeInit({ to: [], subject: "", text: "" })} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
          ✏️ Compose
        </button>
      </div>

      <div style={wrap}>
        {/* Folder rail */}
        <nav style={rail} aria-label="Folders">
          {FOLDERS.map((f) => (
            <button key={f} style={railBtn(f === folder)} onClick={() => setFolder(f)} aria-current={f === folder}>
              {FOLDER_LABEL[f] ?? f}
              {f === "inbox" && unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
          ))}
        </nav>

        {/* Message list */}
        <div style={listCol}>
          {loading && <p style={{ padding: 16, color: "#666" }}>Loading…</p>}
          {error && <p style={{ padding: 16, color: "#b91c1c" }}>{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p style={{ padding: 16, color: "#666" }}>No messages in {FOLDER_LABEL[folder] ?? folder}.</p>
          )}
          {items.map((m) => {
            const active = selected?.messageId === m.messageId;
            return (
              <button
                key={m.messageId}
                onClick={() => void open(m)}
                aria-label={`Open: ${m.subject}`}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderBottom: "1px solid #eee",
                  background: active ? "#f5f3ff" : "white",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: m.flags.unread ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.flags.starred ? "⭐ " : ""}
                    {fromLabel(m)}
                  </span>
                  <span style={{ color: "#999", fontSize: 12, flexShrink: 0 }}>{shortDate(m.date)}</span>
                </div>
                <div style={{ fontWeight: m.flags.unread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.hasAttachments ? "📎 " : ""}
                  {m.subject}
                </div>
                <div style={{ color: "#888", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</div>
              </button>
            );
          })}
        </div>

        {/* Detail pane */}
        <div style={detailCol}>
          {!selected && <p style={{ color: "#666" }}>Select a message to read it.</p>}
          {selected && (
            <article>
              <h3 style={{ margin: "0 0 4px" }}>{selected.subject}</h3>
              <div style={{ color: "#555", fontSize: 13 }}>
                From <strong>{fromLabel(selected)}</strong> &lt;{selected.from.address}&gt;
              </div>
              <div style={{ color: "#777", fontSize: 12 }}>
                To {selected.to.map((t) => t.address).join(", ")} · {shortDate(selected.date)}
              </div>
              {selected.verdicts && (
                <div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>
                  SPF {selected.verdicts.spf} · DKIM {selected.verdicts.dkim} · DMARC {selected.verdicts.dmarc} · spam {selected.verdicts.spam}
                </div>
              )}
              {selected.attachments && selected.attachments.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.attachments.map((a, i) => (
                    <button
                      key={`${a.filename}-${i}`}
                      onClick={() => void downloadAttachment(selected.messageId, i)}
                      style={{ cursor: "pointer", fontSize: 13, border: "1px solid #ddd", borderRadius: 8, padding: "4px 10px", background: "#fafafa" }}
                    >
                      📎 {a.filename} ({Math.max(1, Math.round(a.sizeBytes / 1024))} KB) ⬇
                    </button>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => startReply("reply")} style={{ cursor: "pointer" }}>↩︎ Reply</button>
                {selected.to.length > 1 && (
                  <button onClick={() => startReply("replyAll")} style={{ cursor: "pointer" }}>↩︎ Reply all</button>
                )}
                <button onClick={() => startReply("forward")} style={{ cursor: "pointer" }}>↪ Forward</button>
                <button onClick={() => void toggleRead(selected)} style={{ cursor: "pointer" }}>
                  {selected.flags.unread ? "Mark read" : "Mark unread"}
                </button>
                <button onClick={() => void toggleStar(selected)} style={{ cursor: "pointer" }}>
                  {selected.flags.starred ? "Unstar" : "Star"}
                </button>
                {folder !== "trash" ? (
                  <button aria-label="Move to Trash" onClick={() => void moveTo(selected, "trash")} style={{ cursor: "pointer" }}>
                    🗑 Trash
                  </button>
                ) : (
                  <button aria-label="Restore to Inbox" onClick={() => void moveTo(selected, "inbox")} style={{ cursor: "pointer" }}>
                    ↩︎ Restore to Inbox
                  </button>
                )}
              </div>

              <MessageBody
                parsed={parsed}
                raw={raw}
                allowImages={allowImages}
                onLoadImages={() => setAllowImages(true)}
                showRaw={showRaw}
                onToggleRaw={() => setShowRaw((v) => !v)}
              />
            </article>
          )}
        </div>
      </div>

      {composeInit && (
        <ComposeDialog
          init={composeInit}
          onClose={() => setComposeInit(null)}
          onSend={async (input) => {
            await mail.send(input);
            setComposeInit(null);
            setFolder("sent");
            await refresh("sent");
          }}
        />
      )}
    </section>
  );
}

function MessageBody({
  parsed,
  raw,
  allowImages,
  onLoadImages,
  showRaw,
  onToggleRaw,
}: {
  parsed: ParsedBody | null;
  raw: string | null;
  allowImages: boolean;
  onLoadImages: () => void;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const sanitized = useMemo(
    () => (parsed?.html ? sanitizeHtml(parsed.html, { allowRemoteImages: allowImages }) : null),
    [parsed, allowImages],
  );

  if (!parsed && !raw) return <p style={{ color: "#888" }}>Loading message…</p>;

  const preStyle: React.CSSProperties = { ...mono, marginTop: 8, background: "#fafafa", border: "1px solid #eee", borderRadius: 8, padding: 12 };
  const htmlStyle: React.CSSProperties = { marginTop: 8, border: "1px solid #eee", borderRadius: 8, padding: 12, overflowX: "auto" };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onToggleRaw} style={{ cursor: "pointer", fontSize: 12, background: "none", border: "none", color: "#7c3aed", textDecoration: "underline" }}>
          {showRaw ? "View formatted" : "View raw source"}
        </button>
      </div>

      {showRaw ? (
        <pre style={preStyle}>{raw}</pre>
      ) : sanitized ? (
        <>
          {sanitized.blockedRemote && !allowImages && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>
              <span>🛡 Remote images blocked to protect your privacy.</span>
              <button onClick={onLoadImages} style={{ cursor: "pointer", padding: "4px 10px" }}>Load images</button>
            </div>
          )}
          {/* Safe: HTML is sanitized by DOMPurify (lib/mailBody.ts) before it reaches the DOM. */}
          <div style={htmlStyle} dangerouslySetInnerHTML={{ __html: sanitized.clean }} />
        </>
      ) : (
        <pre style={preStyle}>{parsed?.text ?? raw}</pre>
      )}
    </div>
  );
}

function ComposeDialog({
  init,
  onClose,
  onSend,
}: {
  init: ComposeInit;
  onClose: () => void;
  onSend: (input: {
    to: string[];
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  }) => Promise<void>;
}) {
  const [to, setTo] = useState(init.to.join(", "));
  const [subject, setSubject] = useState(init.subject);
  const [text, setText] = useState(init.text);
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setErr(null);
    try {
      const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
      if (recipients.length === 0) throw new Error("Add at least one recipient");
      // Send a formatted HTML body (rendered from Markdown) + a plaintext fallback.
      const html = text.trim() ? renderMarkdown(text) : undefined;
      await onSend({ to: recipients, subject, text, html, inReplyTo: init.inReplyTo, references: init.references });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Compose message"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ background: "white", borderRadius: 12, padding: 20, width: 480, maxWidth: "90vw" }}>
        <h3 style={{ marginTop: 0 }}>{init.inReplyTo ? "Reply" : "New message"}</h3>
        <label style={{ display: "block", fontSize: 13, color: "#555" }}>To (comma-separated)</label>
        <input aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@example.com" style={{ width: "100%", padding: 8, marginBottom: 8 }} />
        <label style={{ display: "block", fontSize: 13, color: "#555" }}>Subject</label>
        <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", padding: 8, marginBottom: 8 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label style={{ fontSize: 13, color: "#555" }}>Message <span style={{ color: "#999" }}>· Markdown supported</span></label>
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            style={{ cursor: "pointer", fontSize: 12, background: "none", border: "none", color: "#7c3aed", textDecoration: "underline" }}
          >
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div
            aria-label="Preview"
            style={{ minHeight: 120, border: "1px solid #eee", borderRadius: 6, padding: 8, background: "#fafafa" }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : (
          <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ width: "100%", padding: 8 }} />
        )}
        {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose} disabled={sending} style={{ cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={sending} style={{ cursor: "pointer" }}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
