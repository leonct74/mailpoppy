// Last-known message listings, persisted per mailbox+folder so the inbox renders
// INSTANTLY on open and on mailbox switch (stale-while-revalidate: show the cache,
// refresh silently in the background). Only message METADATA is stored — subjects,
// senders, snippets, flags — the same fields the list screen shows; bodies live in
// the separate messageCache. Cleared on sign-out.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MessageMeta, Folder } from "@mailpoppy/core";

const PREFIX = "@mailpoppy/inbox/";
// One page is what the list shows before scrolling; caching more just slows hydration.
const MAX_ITEMS = 50;

const key = (email: string, folder: Folder) => `${PREFIX}${email.trim().toLowerCase()}/${folder}`;

export async function loadInboxCache(email: string, folder: Folder): Promise<MessageMeta[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key(email, folder));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: MessageMeta[] };
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

export function saveInboxCache(email: string, folder: Folder, items: MessageMeta[]): void {
  void AsyncStorage.setItem(
    key(email, folder),
    JSON.stringify({ items: items.slice(0, MAX_ITEMS), savedAt: Date.now() }),
  ).catch(() => {});
}

/** Drop the cached inbox listing for ONE mailbox — used when a push says it got new
 *  mail while it wasn't the mailbox on screen, so switching to it can't show a stale
 *  list that's missing the just-arrived message (the fresh load then repopulates it). */
export async function invalidateInboxCache(email: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(email, "inbox"));
  } catch {
    /* best-effort */
  }
}

/** Wipe every mailbox's cached listings (full sign-out). */
export async function clearInboxCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    /* best-effort */
  }
}

// ── A tiny "new mail arrived" signal ─────────────────────────────────────────
// The push listener (App root) fires this when a notification arrives while the
// app is open; the inbox subscribes and silently reloads, so new mail appears
// without waiting for a pull-to-refresh.

type Listener = (mailbox: string) => void;
const listeners = new Set<Listener>();

export function onNewMail(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyNewMail(mailbox: string): void {
  for (const fn of listeners) fn(mailbox.trim().toLowerCase());
}
