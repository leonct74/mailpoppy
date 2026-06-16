"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import DOMPurify from "dompurify";
import { mail } from "@/lib/mailClient";
import { parseEml, bareAddress, type ParsedEmail } from "@/lib/eml";
import type { Folder } from "@/lib/mailpoppy/types";
import type { ComposeInit } from "./Composer";
import {
  ArrowLeftIcon,
  ReplyIcon,
  ForwardIcon,
  TrashIcon,
  MailOpenIcon,
  DocumentIcon,
  ImageIcon,
} from "./icons";

export function Reader({
  messageId,
  folder,
  subject,
  onBack,
  onCompose,
  onMoved,
}: {
  messageId: string;
  folder: Folder;
  subject: string;
  onBack: () => void;
  onCompose: (init: ComposeInit) => void;
  onMoved: () => void;
}) {
  const [email, setEmail] = useState<ParsedEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let alive = true;
    void mail.setFlags(messageId, { unread: false }).catch(() => {});
    void (async () => {
      try {
        const { eml } = await mail.getRaw(messageId);
        const parsed = await parseEml(eml);
        if (alive) setEmail(parsed);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [messageId]);

  // Sanitize on the client only (DOMPurify needs a DOM). Images are dropped until
  // the user opts in, so remote tracking pixels don't fire automatically. The body
  // renders on a light surface inside the iframe — HTML email is authored for a
  // white background, so forcing it dark would break most messages.
  const srcDoc = useMemo(() => {
    if (!email?.html) return null;
    const clean = DOMPurify.sanitize(email.html, {
      FORBID_TAGS: showImages ? [] : ["img"],
      FORBID_ATTR: ["srcset"],
    });
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'"><style>body{font-family:system-ui,-apple-system,sans-serif;color:#1f2937;background:#ffffff;margin:14px;word-wrap:break-word;overflow-wrap:break-word}img{max-width:100%;height:auto}a{color:#1a73e8}</style></head><body>${clean}</body></html>`;
  }, [email, showImages]);

  function reply() {
    if (!email) return;
    onCompose({
      to: bareAddress(email.from),
      subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
      inReplyTo: email.messageId ?? undefined,
      references: [email.references, email.messageId].filter(Boolean).join(" ") || undefined,
    });
  }

  function forward() {
    if (!email) return;
    const quoted =
      `<br><br><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">` +
      `<div><b>From:</b> ${escapeHtml(email.from)}</div>` +
      (email.date ? `<div><b>Date:</b> ${escapeHtml(new Date(email.date).toLocaleString())}</div>` : "") +
      `<div><b>Subject:</b> ${escapeHtml(email.subject)}</div>` +
      (email.to ? `<div><b>To:</b> ${escapeHtml(email.to)}</div>` : "") +
      `<br>${email.html ?? escapeHtml(email.text)}</blockquote>`;
    onCompose({
      subject: /^fwd?:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`,
      html: quoted,
    });
  }

  async function moveTo(target: "trash" | "inbox") {
    setMoving(true);
    try {
      await mail.move(messageId, target);
      onMoved();
    } catch (e) {
      setMoving(false);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function openAttachment(index: number) {
    try {
      const { url } = await mail.getAttachmentUrl(messageId, index);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const inTrash = folder === "trash";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-hairline flex items-center gap-1.5 border-b px-3 py-2.5">
        <button
          onClick={onBack}
          className="text-muted hover:bg-surface-variant flex h-9 w-9 items-center justify-center rounded-full transition-colors"
          aria-label="Back"
        >
          <ArrowLeftIcon size={22} />
        </button>
        <div className="flex-1" />
        {email && (
          <>
            <ActionBtn label="Reply" icon={ReplyIcon} onClick={reply} primary />
            <ActionBtn label="Forward" icon={ForwardIcon} onClick={forward} />
            <button
              onClick={() => moveTo(inTrash ? "inbox" : "trash")}
              disabled={moving}
              aria-label={inTrash ? "Restore" : "Trash"}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                inTrash ? "text-muted hover:bg-surface-variant" : "text-danger hover:bg-[rgba(255,180,171,0.08)]"
              }`}
            >
              {inTrash ? <MailOpenIcon size={20} /> : <TrashIcon size={20} />}
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="text-muted p-6 text-sm">Couldn&apos;t open this message: {error}</div>
        ) : !email ? (
          <div className="text-dim flex items-center gap-3 p-6 text-sm">
            <span className="border-surface-variant border-t-primary h-4 w-4 animate-spin rounded-full border-2" />
            Loading…
          </div>
        ) : (
          <div className="mx-auto max-w-3xl p-5">
            <h1 className="text-text text-2xl leading-tight font-bold">{email.subject || subject}</h1>

            <div className="bg-primary/12 text-primary mt-3 inline-block rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide uppercase">
              {folderLabel(folder)}
            </div>

            {/* Sender card */}
            <div className="bg-surface mt-4 flex items-center gap-3 rounded-2xl p-3.5">
              <Avatar label={email.from} />
              <div className="min-w-0 flex-1">
                <div className="text-text truncate text-base font-semibold">{displayName(email.from)}</div>
                <div className="text-muted truncate text-xs">
                  {bareAddress(email.from)}
                  {email.date ? ` • ${new Date(email.date).toLocaleString()}` : ""}
                </div>
                {email.to && <div className="text-muted truncate text-xs">To: {email.to}</div>}
              </div>
            </div>

            {email.attachments.length > 0 && (
              <div className="mt-4">
                <p className="text-muted mb-1.5 text-xs font-semibold tracking-wide">
                  {email.attachments.length} attachment{email.attachments.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {email.attachments.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => openAttachment(i)}
                      className="bg-surface-high text-text hover:bg-surface-variant flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors"
                    >
                      <span className="text-primary">
                        <DocumentIcon size={18} />
                      </span>
                      {a.filename}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {email.html && !showImages && (
              <button
                onClick={() => setShowImages(true)}
                className="bg-surface-high text-muted hover:bg-surface-variant mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
              >
                <ImageIcon size={15} />
                Images are hidden to protect your privacy — show images
              </button>
            )}

            <div className="border-hairline mt-4 border-t pt-4">
              {srcDoc ? (
                <iframe
                  sandbox=""
                  srcDoc={srcDoc}
                  title="message body"
                  className="w-full rounded-xl bg-white"
                  style={{ height: "60vh" }}
                />
              ) : (
                <pre className="text-text font-sans text-sm break-words whitespace-pre-wrap">
                  {email.text || "(no content)"}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  icon: Icon,
  onClick,
  primary,
}: {
  label: string;
  icon: ComponentType<{ size?: number }>;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        primary
          ? "bg-primary text-primary-text hover:opacity-90"
          : "bg-surface text-text hover:bg-surface-variant"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function folderLabel(f: Folder): string {
  const s = String(f);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The display name part, or the bare address if there's no name. */
function displayName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : bareAddress(addr)).trim() || addr;
}

function Avatar({ label }: { label: string }) {
  const initial = (displayName(label).trim()[0] || "?").toUpperCase();
  return (
    <div className="bg-surface-variant text-heading flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold">
      {initial}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
