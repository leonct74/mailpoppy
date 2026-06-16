"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { mail } from "@/lib/mailClient";
import { loadContacts, resetContacts, type Contact } from "@/lib/contacts";
import { RecipientsInput } from "./RecipientsInput";
import { CloseIcon, SendIcon } from "./icons";

export interface ComposeInit {
  to?: string;
  subject?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  /** Set when editing an existing draft — save/send/discard act on this draft. */
  draftId?: string;
}

export function Composer({
  initial,
  onClose,
  onSent,
  selfEmail,
}: {
  initial?: ComposeInit;
  onClose: () => void;
  // Called after the message list changed (sent / saved / discarded a draft) so
  // the parent closes the composer and refreshes the folder.
  onSent: () => void;
  /** The signed-in address — excluded from autocomplete suggestions. */
  selfEmail?: string | null;
}) {
  const [to, setTo] = useState(initial?.to ?? "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [draftId, setDraftId] = useState<string | undefined>(initial?.draftId);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    let alive = true;
    void loadContacts(selfEmail ?? undefined).then((c) => {
      if (alive) setContacts(c);
    });
    return () => {
      alive = false;
    };
  }, [selfEmail]);

  const editor = useEditor({
    immediatelyRender: false, // required: avoids Next.js SSR hydration error
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
    ],
    content: initial?.html ?? "",
    editorProps: {
      attributes: {
        class: "mp-compose min-h-[260px] px-4 py-3 focus:outline-none text-text",
      },
    },
  });

  const parseList = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
  const recipients = parseList(to);
  const ccList = parseList(cc);
  const bccList = parseList(bcc);
  const busy = sending || saving;
  const canSend = recipients.length + ccList.length + bccList.length > 0 && !busy;
  // Enough to be worth keeping as a draft (avoid saving truly empty drafts).
  const hasContent =
    recipients.length > 0 ||
    subject.trim().length > 0 ||
    (editor?.getText().trim().length ?? 0) > 0;
  const canSave = hasContent && !busy;

  async function send() {
    if (!canSend || !editor) return;
    setSending(true);
    setError(null);
    try {
      const html = editor.getHTML();
      const text = editor.getText();
      await mail.send({
        to: recipients,
        ...(ccList.length ? { cc: ccList } : {}),
        ...(bccList.length ? { bcc: bccList } : {}),
        subject: subject.trim(),
        html,
        text,
        inReplyTo: initial?.inReplyTo,
        references: initial?.references,
        draftId, // server removes the draft once the mail is sent
      });
      resetContacts(); // the new recipient becomes a suggestion next time
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  async function saveDraft() {
    if (!canSave || !editor) return;
    setSaving(true);
    setError(null);
    try {
      const res = await mail.saveDraft({
        draftId,
        to: recipients,
        subject: subject.trim(),
        html: editor.getHTML(),
        text: editor.getText(),
        inReplyTo: initial?.inReplyTo,
        references: initial?.references,
      });
      setDraftId(res.draftId);
      onSent(); // close + refresh so the draft shows in the Drafts folder
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  async function discard() {
    // Discarding an existing draft removes it; a brand-new compose just closes.
    if (draftId) {
      setSaving(true);
      try {
        await mail.deleteDraft(draftId);
      } catch {
        /* best-effort — the draft may already be gone */
      }
      onSent();
    } else {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-container border-hairline flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl">
        <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-text text-sm font-bold">New message</h2>
          <button
            onClick={onClose}
            className="text-muted hover:bg-surface-variant flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="divide-hairline border-hairline flex flex-col divide-y border-b">
          <div className="relative">
            <RecipientsInput value={to} onChange={setTo} contacts={contacts} />
            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="text-muted hover:text-text absolute top-2.5 right-3 z-10 text-xs font-semibold"
              >
                Cc/Bcc
              </button>
            )}
          </div>
          {showCcBcc && (
            <>
              <RecipientsInput value={cc} onChange={setCc} contacts={contacts} placeholder="Cc" />
              <RecipientsInput value={bcc} onChange={setBcc} contacts={contacts} placeholder="Bcc" />
            </>
          )}
          <input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="text-text placeholder:text-dim bg-transparent px-4 py-2.5 text-sm outline-none"
          />
        </div>

        <Toolbar editor={editor} />

        <div className="flex-1 overflow-auto">
          <EditorContent editor={editor} />
        </div>

        {error && <p className="text-danger px-4 py-2 text-sm">{error}</p>}

        <div className="border-hairline flex items-center gap-2 border-t px-4 py-3">
          <button
            onClick={discard}
            disabled={busy}
            className="text-muted hover:bg-surface-variant rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
          >
            {draftId ? "Discard draft" : "Discard"}
          </button>
          <div className="flex-1" />
          <button
            onClick={saveDraft}
            disabled={!canSave}
            className="border-hairline text-text hover:bg-surface rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={send}
            disabled={!canSend}
            className="bg-primary text-primary-text flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <SendIcon size={16} />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="border-hairline bg-surface-high h-10 border-y" />;

  const Btn = ({
    onClick,
    active,
    label,
    title,
  }: {
    onClick: () => void;
    active?: boolean;
    label: string;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-8 rounded px-2 py-1 text-sm font-semibold transition-colors ${
        active ? "bg-primary text-primary-text" : "text-muted hover:bg-surface-variant"
      }`}
    >
      {label}
    </button>
  );

  function setLink() {
    const prev = editor!.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor!.chain().focus().unsetLink().run();
    else editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  return (
    <div className="border-hairline bg-surface-high flex flex-wrap items-center gap-1 border-y px-2 py-1.5">
      <Btn title="Bold" label="B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn title="Italic" label="I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn title="Strikethrough" label="S" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <span className="bg-surface-variant mx-1 h-5 w-px" />
      <Btn title="Bullet list" label="• List" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Btn title="Numbered list" label="1. List" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Btn title="Quote" label="❝" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <span className="bg-surface-variant mx-1 h-5 w-px" />
      <Btn title="Link" label="🔗" active={editor.isActive("link")} onClick={setLink} />
    </div>
  );
}
