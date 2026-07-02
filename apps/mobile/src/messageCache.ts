// Recently-read messages, cached on device so re-opening one is instant and works
// offline. An email is immutable once received, so a cache hit needs NO network
// round-trip at all. We store the raw EML exactly AS FETCHED — for an encrypted
// message that is the ciphertext, so encrypted mail stays encrypted at rest here
// too (decryption still happens per-open with the in-memory key). The encryption
// meta (encrypted/encWrappedKey) is stored alongside, which also spares the
// notification-tap path its metadata list lookup. Small LRU (bounded count and
// per-message size) — this is a recency cache, not an offline copy of the mailbox.
import AsyncStorage from "@react-native-async-storage/async-storage";

const ENTRY_PREFIX = "@mailpoppy/eml/";
const INDEX_KEY = "@mailpoppy/emlIndex";
const MAX_ENTRIES = 30;
// EMLs carry base64 inline parts and can get huge; don't let one message bloat storage.
const MAX_EML_CHARS = 300_000;

export interface CachedMessage {
  eml: string;
  encrypted?: boolean;
  encWrappedKey?: string;
}

const entryKey = (messageId: string) => `${ENTRY_PREFIX}${messageId}`;

async function loadIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function loadCachedMessage(messageId: string): Promise<CachedMessage | null> {
  try {
    const raw = await AsyncStorage.getItem(entryKey(messageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedMessage>;
    if (typeof parsed.eml !== "string") return null;
    return { eml: parsed.eml, encrypted: parsed.encrypted, encWrappedKey: parsed.encWrappedKey };
  } catch {
    return null;
  }
}

export async function saveCachedMessage(messageId: string, msg: CachedMessage): Promise<void> {
  if (msg.eml.length > MAX_EML_CHARS) return;
  try {
    await AsyncStorage.setItem(entryKey(messageId), JSON.stringify(msg));
    const index = await loadIndex();
    const next = [messageId, ...index.filter((id) => id !== messageId)];
    const evicted = next.slice(MAX_ENTRIES);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next.slice(0, MAX_ENTRIES)));
    if (evicted.length) await AsyncStorage.multiRemove(evicted.map(entryKey));
  } catch {
    /* caching is best-effort */
  }
}

/** Drop every cached message (full sign-out). */
export async function clearMessageCache(): Promise<void> {
  try {
    const index = await loadIndex();
    await AsyncStorage.multiRemove([INDEX_KEY, ...index.map(entryKey)]);
  } catch {
    /* best-effort */
  }
}
