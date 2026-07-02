// Conversation grouping for the inbox: messages sharing a threadId collapse into
// one row (the newest message fronts it). Pure — the list screen decides when to
// apply it (inbox only; other folders and search results stay flat).
import type { MessageMeta } from "@mailpoppy/core";

export interface ThreadGroup {
  /** The newest message — what the collapsed row displays. */
  latest: MessageMeta;
  /** All messages in the thread, newest first. */
  messages: MessageMeta[];
  count: number;
  /** True when ANY message in the thread is unread. */
  unread: boolean;
}

/** Group a date-descending listing into threads, preserving recency order. */
export function groupByThread(items: MessageMeta[]): ThreadGroup[] {
  const byThread = new Map<string, ThreadGroup>();
  for (const m of items) {
    const key = m.threadId || m.messageId;
    const existing = byThread.get(key);
    if (existing) {
      existing.messages.push(m);
      existing.count++;
      existing.unread = existing.unread || m.flags.unread;
    } else {
      byThread.set(key, { latest: m, messages: [m], count: 1, unread: m.flags.unread });
    }
  }
  return [...byThread.values()];
}

/** Wrap each message as its own group (flat mode: other folders, search). */
export function ungrouped(items: MessageMeta[]): ThreadGroup[] {
  return items.map((m) => ({ latest: m, messages: [m], count: 1, unread: m.flags.unread }));
}
