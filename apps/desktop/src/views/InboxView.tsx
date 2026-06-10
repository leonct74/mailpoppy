import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Inbox as InboxIcon,
  Send,
  FileText,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  PenSquare,
  Search,
  Star,
  Paperclip,
  Reply as ReplyIcon,
  ReplyAll,
  Forward,
  MailOpen,
  Mail,
  AtSign,
  Undo2,
  Download,
  X,
  ExternalLink,
  Copy,
  ImageOff,
  ShieldQuestion,
} from "lucide-react";
import type { MessageMeta, Folder } from "@mailpoppy/core";
import { formatBytes, usagePercent, usageLevel } from "@mailpoppy/core";
import { makeMailClient, type MailClient, type SendAttachment, type MailboxUsage } from "../lib/mailClient";
import { filesToAttachments } from "../lib/attachments";
import { openExternal } from "../lib/openExternal";
import { SecurityInfo } from "./SecurityInfo";
import { parseBody, sanitizeHtml, type ParsedBody } from "../lib/mailBody";
import { buildReply, type ComposeInit, type ReplyMode } from "../lib/reply";
import { renderMarkdown } from "../lib/compose";
import { filterMessages } from "../lib/search";
import { Button, Spinner, cn } from "../ui";

// Phase 2 mailbox UI: browse folders, read a message (sanitized HTML, remote
// images blocked by default), toggle read/star, move to trash / restore, and
// compose → send. Talks to a MailClient (the shared api-client against a
// deployed backend, or the demo client offline) — so this view is identical
// for desktop and, later, mobile.

const FOLDERS: Folder[] = ["inbox", "sent", "drafts", "trash", "junk"];
const FOLDER_LABEL: Record<string, string> = {
  inbox: "Inbox",
  sent: "Sent",
  drafts: "Drafts",
  trash: "Trash",
  junk: "Junk",
};
const FOLDER_ICON: Record<string, typeof InboxIcon> = {
  inbox: InboxIcon,
  sent: Send,
  drafts: FileText,
  trash: Trash2,
  junk: ShieldAlert,
};

function fromLabel(m: MessageMeta): string {
  return m.from.name || m.from.address || "(unknown)";
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function InboxView({
  client,
  demo,
  onConnect,
  mailboxEmail,
}: {
  client?: MailClient;
  demo?: boolean;
  onConnect?: () => void;
  /** The signed-in mailbox address, shown atop the folder pane so it's always
   *  clear which inbox you're viewing. Omitted in demo mode. */
  mailboxEmail?: string | null;
}) {
  const mail = useMemo<MailClient>(() => client ?? makeMailClient(), [client]);

  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MessageMeta[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MessageMeta | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBody | null>(null);
  const [allowImages, setAllowImages] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeInit, setComposeInit] = useState<ComposeInit | null>(null);
  // Fallback when the OS can't auto-open a download (e.g. a Tauri build whose
  // opener plugin isn't active yet): surface the link so the user is never stuck.
  const [attachmentLink, setAttachmentLink] = useState<{ url: string; filename: string } | null>(null);
  // One-time security note explaining SES's built-in virus/spam scanning.
  const [scanNoteDismissed, setScanNoteDismissed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("mailpoppy.scanNoteDismissed") === "1",
  );
  const [securityOpen, setSecurityOpen] = useState(false);
  const [usage, setUsage] = useState<MailboxUsage | null>(null);

  async function loadUsage() {
    try {
      setUsage(await mail.getUsage());
    } catch {
      setUsage(null); // usage is informational; never block the inbox on it
    }
  }
  useEffect(() => {
    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail]);

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
    setQuery("");
    void refresh(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, mail]);

  async function open(m: MessageMeta) {
    setSelected(m);
    setRaw(null);
    setParsed(null);
    setAllowImages(false); // re-block remote content for each newly opened message
    setShowRaw(false);
    setAttachmentLink(null);

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

  async function downloadAttachment(messageId: string, index: number, _filename: string) {
    setAttachmentLink(null);
    try {
      const { url } = await mail.getAttachmentUrl(messageId, index);
      // Hand the presigned URL to the OS (window.open is a no-op in the webview).
      const opened = await openExternal(url);
      // If nothing could open it (Tauri opener not active yet), show the link.
      if (!opened) setAttachmentLink({ url, filename: _filename });
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
  const visible = filterMessages(items, query);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      {demo && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200">
          <span>
            🧪 <strong className="font-semibold">Demo data</strong> — not connected to a live mailbox.
          </span>
          {onConnect && (
            <Button size="sm" variant="secondary" onClick={onConnect}>
              Connect a deployment
            </Button>
          )}
        </div>
      )}

      <SecurityInfo open={securityOpen} onClose={() => setSecurityOpen(false)} />

      {!demo && !scanNoteDismissed && (
        <div className="flex shrink-0 items-start justify-between gap-3 rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-2.5 text-sm">
          <span className="text-secondary/90">
            🛡 <strong className="font-semibold">Incoming mail is automatically scanned for viruses and spam by AWS SES.</strong>{" "}
            A message that fails the virus check is quarantined to Junk and never reaches your inbox. Each message shows its
            scan result (virus / SPF / DKIM / DMARC / spam). Note: this is AWS's built-in scan — it's not a substitute for
            your own device antivirus when you download a file.
          </span>
          <button
            onClick={() => {
              try {
                localStorage.setItem("mailpoppy.scanNoteDismissed", "1");
              } catch {
                /* ignore */
              }
              setScanNoteDismissed(true);
            }}
            className="shrink-0 whitespace-nowrap rounded px-2 py-1 text-secondary hover:bg-secondary/10"
          >
            Got it
          </button>
        </div>
      )}

      {/* Three-pane inbox */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low shadow-lg">
        {/* Pane 1 — folders & actions */}
        <div className="flex w-60 shrink-0 flex-col border-r border-outline-variant/20 bg-surface-container-lowest/60">
          {mailboxEmail && (
            <div className="flex items-center gap-2.5 border-b border-outline-variant/10 px-4 py-3" title={mailboxEmail}>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-container/20 text-primary">
                <AtSign className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Signed in as</div>
                <div className="truncate text-sm font-medium text-on-surface">{mailboxEmail}</div>
              </div>
            </div>
          )}
          <div className="border-b border-outline-variant/10 p-4">
            <Button className="w-full" onClick={() => setComposeInit({ to: [], subject: "", text: "" })}>
              <PenSquare className="size-4" />
              Compose
            </Button>
          </div>
          <nav aria-label="Folders" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="mb-1 ml-2 mt-1 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">Mailbox</div>
            {FOLDERS.map((f) => {
              const active = f === folder;
              const Icon = FOLDER_ICON[f] ?? Mail;
              const count = f === "inbox" ? unreadCount : 0;
              return (
                <button
                  key={f}
                  onClick={() => setFolder(f)}
                  aria-current={active}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "border border-primary/10 bg-primary-container/10 font-medium text-primary"
                      : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="size-4" />
                    {FOLDER_LABEL[f] ?? f}
                  </span>
                  {count > 0 && (
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-xs text-primary">{count}</span>
                  )}
                </button>
              );
            })}

            <div className="mb-1 ml-2 mt-6 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">Tools</div>
            <button
              onClick={() => setSecurityOpen(true)}
              title="How your email is protected"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
            >
              <ShieldCheck className="size-4 text-tertiary" />
              Security
            </button>

            {usage && <StorageMeter usage={usage} />}
          </nav>
        </div>

        {/* Pane 2 — message list */}
        <div className="flex w-80 shrink-0 flex-col border-r border-outline-variant/20 bg-surface-container-low">
          <div className="border-b border-outline-variant/10 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
              <input
                aria-label="Search messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${FOLDER_LABEL[folder] ?? folder}…`}
                className="w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest py-1.5 pl-8 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 divide-y divide-outline-variant/10 overflow-y-auto">
            {loading && (
              <p className="flex items-center gap-2 p-4 text-sm text-on-surface-variant">
                <Spinner /> Loading…
              </p>
            )}
            {error && <p className="p-4 text-sm text-tertiary">{error}</p>}
            {!loading && !error && items.length === 0 && (
              <p className="p-4 text-sm text-on-surface-variant">No messages in {FOLDER_LABEL[folder] ?? folder}.</p>
            )}
            {!loading && !error && items.length > 0 && visible.length === 0 && (
              <p className="p-4 text-sm text-on-surface-variant">No messages match “{query}”.</p>
            )}
            {visible.map((m) => {
              const active = selected?.messageId === m.messageId;
              const unread = m.flags.unread;
              return (
                <button
                  key={m.messageId}
                  onClick={() => void open(m)}
                  aria-label={`Open: ${m.subject}`}
                  className={cn(
                    "block w-full border-l-2 p-4 text-left transition-colors hover:bg-surface-container",
                    active ? "border-l-primary bg-primary/10" : unread ? "border-l-primary bg-primary/5" : "border-l-transparent",
                  )}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className={cn("flex items-center gap-1 truncate", unread ? "font-bold text-on-surface" : "text-on-surface-variant")}>
                      {m.flags.starred && <Star className="size-3.5 shrink-0 fill-amber-300 text-amber-300" />}
                      {fromLabel(m)}
                    </span>
                    <span className={cn("shrink-0 whitespace-nowrap font-mono text-xs", unread ? "text-primary" : "text-on-surface-variant")}>
                      {shortDate(m.date)}
                    </span>
                  </div>
                  <div className={cn("mb-1 flex items-center gap-1 truncate text-sm", unread ? "font-semibold text-on-surface" : "text-on-surface")}>
                    {m.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-on-surface-variant" />}
                    {m.subject}
                  </div>
                  <div className="truncate text-xs text-on-surface-variant/70">{m.snippet}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pane 3 — reading / preview */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-outline-variant/10 bg-surface-container shadow-inner">
                <Mail className="size-8 text-on-surface-variant/50" />
              </div>
              <h2 className="mb-2 text-2xl font-semibold text-on-surface">No message selected</h2>
              <p className="max-w-sm text-on-surface-variant">Select a message from the list to read it, or compose a new one.</p>
            </div>
          ) : (
            <article className="flex-1 overflow-y-auto p-6">
              <h3 className="mb-1 text-xl font-semibold text-on-surface">{selected.subject}</h3>
              <div className="text-sm text-on-surface-variant">
                From <strong className="text-on-surface">{fromLabel(selected)}</strong>{" "}
                <span className="font-mono text-xs">&lt;{selected.from.address}&gt;</span>
              </div>
              <div className="text-xs text-on-surface-variant/80">
                To {selected.to.map((t) => t.address).join(", ")} · {shortDate(selected.date)}
              </div>

              {selected.verdicts && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-on-surface-variant">
                  <span
                    title="Antivirus scan result from AWS SES. Virus-positive mail is quarantined and never delivered to the inbox."
                    className={cn(
                      "inline-flex items-center gap-1",
                      selected.verdicts.virus === "PASS" ? "text-secondary" : selected.verdicts.virus === "FAIL" ? "text-tertiary" : "text-on-surface-variant",
                    )}
                  >
                    <ShieldQuestion className="size-3.5" /> virus {selected.verdicts.virus}
                  </span>
                  <span>· SPF {selected.verdicts.spf} · DKIM {selected.verdicts.dkim} · DMARC {selected.verdicts.dmarc} · spam {selected.verdicts.spam}</span>
                </div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selected.attachments.map((a, i) => (
                    <button
                      key={`${a.filename}-${i}`}
                      onClick={() => void downloadAttachment(selected.messageId, i, a.filename)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs text-on-surface transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      <Paperclip className="size-3.5" /> {a.filename} ({Math.max(1, Math.round(a.sizeBytes / 1024))} KB)
                      <Download className="size-3.5" />
                    </button>
                  ))}
                </div>
              )}

              {attachmentLink && (
                <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                  <div>
                    Couldn’t open <strong>{attachmentLink.filename}</strong> automatically. Click below, or copy this link into
                    your browser to download it (the link is valid for 5 minutes):
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void openExternal(attachmentLink.url)}>
                      <ExternalLink className="size-3.5" /> Open in browser
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(attachmentLink.url)}>
                      <Copy className="size-3.5" /> Copy link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAttachmentLink(null)}>
                      Dismiss
                    </Button>
                  </div>
                  <input
                    readOnly
                    value={attachmentLink.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="mt-2 w-full rounded border border-outline-variant/30 bg-surface-container-lowest p-1.5 font-mono text-[11px] text-on-surface-variant"
                  />
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/10 pt-4">
                <Button size="sm" variant="secondary" onClick={() => startReply("reply")}>
                  <ReplyIcon className="size-4" /> Reply
                </Button>
                {selected.to.length > 1 && (
                  <Button size="sm" variant="secondary" onClick={() => startReply("replyAll")}>
                    <ReplyAll className="size-4" /> Reply all
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => startReply("forward")}>
                  <Forward className="size-4" /> Forward
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleRead(selected)}>
                  <MailOpen className="size-4" /> {selected.flags.unread ? "Mark read" : "Mark unread"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleStar(selected)}>
                  <Star className="size-4" /> {selected.flags.starred ? "Unstar" : "Star"}
                </Button>
                {folder !== "trash" ? (
                  <Button size="sm" variant="ghost" aria-label="Move to Trash" onClick={() => void moveTo(selected, "trash")}>
                    <Trash2 className="size-4" /> Trash
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" aria-label="Restore to Inbox" onClick={() => void moveTo(selected, "inbox")}>
                    <Undo2 className="size-4" /> Restore to Inbox
                  </Button>
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

          {/* Footer badge */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container/80 px-3 py-1.5 backdrop-blur">
              <ShieldCheck className="size-3.5 text-secondary" />
              <span className="font-mono text-[11px] text-on-surface-variant">Incoming mail scanned &amp; verified by AWS SES</span>
            </div>
          </div>
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

/** Per-mailbox storage meter shown at the foot of the folder rail. */
function StorageMeter({ usage }: { usage: MailboxUsage }) {
  const pct = usagePercent(usage.usedBytes, usage.quotaBytes);
  const level = usageLevel(usage.usedBytes, usage.quotaBytes);
  const barClass = level === "full" ? "bg-tertiary-container" : level === "warn" ? "bg-amber-400" : "bg-primary";
  const textClass = level === "full" ? "text-tertiary" : level === "warn" ? "text-amber-300" : "text-primary";
  return (
    <div aria-label="Mailbox storage" className="mt-auto px-2 pt-4 text-xs text-on-surface-variant">
      {usage.quotaBytes && pct !== null ? (
        <>
          <div className="flex justify-between">
            <span>Storage</span>
            <span className={textClass}>{Math.round(pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div className={cn("h-full", barClass)} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-1 text-on-surface-variant/70">
            {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}
          </div>
          {level === "full" && <div className="mt-0.5 text-tertiary">Full — new mail is bounced.</div>}
          {level === "warn" && <div className="mt-0.5 text-amber-300">Almost full.</div>}
        </>
      ) : (
        <div>Storage: {formatBytes(usage.usedBytes)} used</div>
      )}
    </div>
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

  if (!parsed && !raw) return <p className="mt-3 text-on-surface-variant/70">Loading message…</p>;

  const preClass =
    "mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-3 font-mono text-[13px] text-on-surface";

  return (
    <div className="mt-4">
      <div className="flex justify-end">
        <button onClick={onToggleRaw} className="text-xs text-primary underline-offset-2 hover:underline">
          {showRaw ? "View formatted" : "View raw source"}
        </button>
      </div>

      {showRaw ? (
        <pre className={preClass}>{raw}</pre>
      ) : sanitized ? (
        <>
          {sanitized.blockedRemote && !allowImages && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100">
              <span className="inline-flex items-center gap-2">
                <ImageOff className="size-4" /> Remote images blocked to protect your privacy.
              </span>
              <Button size="sm" variant="secondary" onClick={onLoadImages}>
                Load images
              </Button>
            </div>
          )}
          {/* Safe: HTML is sanitized by DOMPurify (lib/mailBody.ts) before it reaches the DOM. */}
          <div
            className="mt-2 overflow-x-auto rounded-lg border border-outline-variant/10 bg-white p-3 text-slate-800"
            dangerouslySetInnerHTML={{ __html: sanitized.clean }}
          />
        </>
      ) : (
        <pre className={preClass}>{parsed?.text ?? raw}</pre>
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
    attachments?: SendAttachment[];
  }) => Promise<void>;
}) {
  const [to, setTo] = useState(init.to.join(", "));
  const [subject, setSubject] = useState(init.subject);
  const [text, setText] = useState(init.text);
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const added = await filesToAttachments(files);
      setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit() {
    setSending(true);
    setErr(null);
    try {
      const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
      if (recipients.length === 0) throw new Error("Add at least one recipient");
      // Send a formatted HTML body (rendered from Markdown) + a plaintext fallback.
      const html = text.trim() ? renderMarkdown(text) : undefined;
      await onSend({
        to: recipients,
        subject,
        text,
        html,
        inReplyTo: init.inReplyTo,
        references: init.references,
        attachments: attachments.length ? attachments : undefined,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  const fieldLabel = "mb-1 block text-sm text-on-surface-variant";
  const fieldInput =
    "w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div
      role="dialog"
      aria-label="Compose message"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-[480px] max-w-[90vw] rounded-xl border border-outline-variant/20 bg-surface-container p-6 shadow-2xl">
        <h3 className="mb-3 text-lg font-semibold text-on-surface">{init.inReplyTo ? "Reply" : "New message"}</h3>
        <label className={fieldLabel}>To (comma-separated)</label>
        <input aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@example.com" className={cn(fieldInput, "mb-3")} />
        <label className={fieldLabel}>Subject</label>
        <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={cn(fieldInput, "mb-3")} />
        <div className="flex items-baseline justify-between">
          <label className={fieldLabel}>
            Message <span className="text-on-surface-variant/60">· Markdown supported</span>
          </label>
          <button type="button" onClick={() => setPreview((v) => !v)} className="text-xs text-primary underline-offset-2 hover:underline">
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div
            aria-label="Preview"
            className="min-h-[120px] rounded-lg border border-outline-variant/30 bg-white p-2 text-slate-800"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : (
          <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={6} className={cn(fieldInput, "resize-y")} />
        )}

        <div className="mt-3">
          <input aria-label="Attach files" type="file" multiple onChange={(e) => void onFiles(e.target.files)} className="text-xs text-on-surface-variant file:mr-3 file:rounded-md file:border-0 file:bg-surface-container-highest file:px-3 file:py-1.5 file:text-on-surface" />
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span key={`${a.filename}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-surface-container-highest px-2 py-1 text-xs text-on-surface">
                  <Paperclip className="size-3" /> {a.filename}
                  <button
                    aria-label={`Remove ${a.filename}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-1 text-tertiary hover:text-tertiary-container"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {err && <p className="mt-2 text-sm text-tertiary">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={sending}>
            {sending ? <Spinner className="border-white/40 border-t-white" /> : <Send className="size-4" />}
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
