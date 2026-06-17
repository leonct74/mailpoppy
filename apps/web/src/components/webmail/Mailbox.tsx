"use client";

import { useCallback, useEffect, useState } from "react";
import { mail } from "@/lib/mailClient";
import { parseEml } from "@/lib/eml";
import type { Folder, MessageMeta } from "@/lib/mailpoppy/types";
import { Reader } from "./Reader";
import { Composer, type ComposeInit } from "./Composer";
import { Logo } from "./Logo";
import { ComposeIcon, SearchIcon, PaperclipIcon, TrashIcon } from "./icons";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "junk", label: "Junk" },
  { key: "trash", label: "Trash" },
];

const PAGE = 50;

export function Mailbox({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MessageMeta[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    messageId: string;
    subject: string;
    encrypted?: boolean;
    encWrappedKey?: string;
  } | null>(null);
  const [composing, setComposing] = useState<ComposeInit | null>(null);

  const load = useCallback(
    async (f: Folder, mode: "fresh" | "more", cur?: string) => {
      if (mode === "more") setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await mail.list({ folder: f, limit: PAGE, cursor: mode === "more" ? cur : undefined });
        setItems((prev) => (mode === "more" ? [...prev, ...res.items] : res.items));
        setCursor(res.cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(folder, "fresh");
  }, [folder, load]);

  function switchFolder(f: Folder) {
    if (f === folder) return;
    setItems([]);
    setCursor(undefined);
    setQuery("");
    setSelected(null);
    setFolder(f);
  }

  // Permanently purge every message in Trash (server-side hard delete). Guarded
  // by a confirm since it can't be undone.
  async function emptyTrash() {
    if (emptying) return;
    if (!window.confirm("Empty Trash? This permanently deletes every message in Trash. This can't be undone.")) return;
    setEmptying(true);
    try {
      await mail.emptyTrash();
      setItems([]);
      setCursor(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmptying(false);
    }
  }

  // Drafts open back in the composer for editing; everything else opens in the
  // reader. The draft's content is pulled from its stored .eml and parsed.
  async function openItem(m: MessageMeta) {
    if (folder !== "drafts") {
      setSelected({ messageId: m.messageId, subject: m.subject, encrypted: m.encrypted, encWrappedKey: m.encWrappedKey });
      return;
    }
    try {
      const { eml } = await mail.getRaw(m.messageId);
      const parsed = await parseEml(eml);
      setComposing({
        draftId: m.messageId,
        to: parsed.to,
        subject: parsed.subject === "(no subject)" ? "" : parsed.subject,
        html: parsed.html ?? undefined,
        references: parsed.references ?? undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((m) =>
        [m.subject, m.snippet, m.from.name, m.from.address, ...m.to.map((t) => t.address)]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
      )
    : items;

  return (
    <div className="bg-bg flex h-screen flex-col">
      {/* Top bar */}
      <header className="border-hairline flex items-center gap-3 border-b px-4 py-2.5">
        <Logo size="sm" />
        <div className="flex-1" />
        <button
          onClick={() => setComposing({})}
          className="bg-primary text-primary-text flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold tracking-wide transition-opacity hover:opacity-90"
        >
          <ComposeIcon size={18} />
          Compose
        </button>
        <span className="text-dim hidden text-sm sm:inline">{email}</span>
        <button
          onClick={onSignOut}
          className="text-muted hover:bg-surface-variant rounded-lg px-3 py-1.5 text-sm transition-colors"
        >
          Sign out
        </button>
      </header>

      {selected ? (
        <Reader
          messageId={selected.messageId}
          folder={folder}
          subject={selected.subject}
          encrypted={selected.encrypted}
          encWrappedKey={selected.encWrappedKey}
          onBack={() => {
            setSelected(null);
            void load(folder, "fresh");
          }}
          onCompose={(init) => setComposing(init)}
          onMoved={() => {
            setSelected(null);
            void load(folder, "fresh");
          }}
        />
      ) : (
        <>
          {/* Folder tabs + search */}
          <div className="border-hairline flex flex-wrap items-center gap-2 border-b px-4 py-3">
            {FOLDERS.map((f) => (
              <button
                key={String(f.key)}
                onClick={() => switchFolder(f.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  f.key === folder
                    ? "bg-primary text-primary-text"
                    : "bg-surface text-muted hover:bg-surface-variant"
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1" />
            <div className="bg-surface-high focus-within:ring-primary/40 flex w-56 items-center gap-2 rounded-xl px-3 py-2 transition-shadow focus-within:ring-2">
              <span className="text-muted">
                <SearchIcon size={18} />
              </span>
              <input
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="text-text placeholder:text-dim w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          {/* Empty-trash action — only in the Trash folder, when it has anything. */}
          {folder === "trash" && filtered.length > 0 && (
            <div className="border-hairline border-b px-4 py-2.5">
              <button
                onClick={emptyTrash}
                disabled={emptying}
                className="text-danger flex items-center gap-2 rounded-lg border border-[rgba(255,180,171,0.35)] px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-[rgba(255,180,171,0.08)] disabled:opacity-50"
              >
                <TrashIcon size={16} />
                {emptying ? "Emptying…" : "Empty Trash"}
              </button>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-auto px-4 py-3">
            {loading && items.length === 0 ? (
              <div className="text-dim flex items-center gap-3 px-2 py-6 text-sm">
                <span className="border-surface-variant border-t-primary h-4 w-4 animate-spin rounded-full border-2" />
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center px-6 pt-20 text-center">
                <p className="text-text text-base font-bold">
                  {error ? "Couldn't load" : q ? "No matches" : "Nothing here"}
                </p>
                <p className="text-muted mt-1.5 text-sm">
                  {error ?? (q ? "Try a different search." : "Messages will appear here.")}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((m) => (
                  <Row key={m.messageId} item={m} folder={folder} onClick={() => openItem(m)} />
                ))}
                {!q && cursor && (
                  <li className="py-3 text-center">
                    <button
                      onClick={() => load(folder, "more", cursor)}
                      disabled={loadingMore}
                      className="border-hairline text-muted hover:bg-surface rounded-lg border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </>
      )}

      {composing && (
        <Composer
          initial={composing}
          selfEmail={email}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            void load(folder, "fresh");
          }}
        />
      )}
    </div>
  );
}

function Row({ item, folder, onClick }: { item: MessageMeta; folder: Folder; onClick: () => void }) {
  const unread = item.flags.unread;
  const outgoing = folder === "sent" || folder === "drafts";
  const who = outgoing
    ? item.to[0]?.name || item.to[0]?.address || "(no recipient)"
    : item.from.name || item.from.address || "(unknown sender)";
  const seed = (outgoing ? item.to[0]?.address : item.from.address) || who;
  return (
    <li
      onClick={onClick}
      className="bg-surface hover:bg-surface-variant relative flex cursor-pointer items-start gap-3 overflow-hidden rounded-2xl p-3.5 transition-colors"
    >
      {unread && <span className="bg-primary absolute top-1/2 left-0 h-8 w-[3px] -translate-y-1/2 rounded-r" />}
      <Avatar label={who} seed={seed} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[15px] ${unread ? "text-text font-bold" : "text-muted"}`}>
            {outgoing ? `To: ${who}` : who}
          </span>
          <span className={`shrink-0 text-[11px] font-medium ${unread ? "text-primary" : "text-muted"}`}>
            {shortDate(item.date)}
          </span>
        </div>
        <div className={`truncate text-sm ${unread ? "text-text font-semibold" : "text-text"}`}>
          {item.subject || "(no subject)"}
        </div>
        <div className="text-muted flex items-center gap-1 truncate text-[13px]">
          {item.hasAttachments && (
            <span className="text-muted shrink-0">
              <PaperclipIcon size={13} />
            </span>
          )}
          <span className="truncate">{item.snippet}</span>
        </div>
      </div>
    </li>
  );
}

// Muted, dark-friendly avatar tints (the same correspondent stays one colour) —
// ported from the mobile inbox so both clients colour avatars identically.
const AVATAR_COLORS = ["#3b5a7a", "#7a3b4b", "#3b7a5a", "#7a663b", "#5a3b7a", "#3b6f7a", "#7a3b6a", "#5c6b3b"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function Avatar({ label, seed }: { label: string; seed: string }) {
  const initial = (label.trim()[0] || "?").toUpperCase();
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
      style={{ backgroundColor: avatarColor(seed) }}
    >
      {initial}
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
