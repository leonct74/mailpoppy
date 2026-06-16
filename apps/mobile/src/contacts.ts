// A derived address book for compose autocomplete — no server "contacts" store.
// We scan recent inbox senders + sent recipients, dedupe by address, and rank by
// how often each address appears (then most-recent). Cached for the session so
// the Compose screen opens instantly; reset on sign-out so one mailbox's history
// never bleeds into the next.
import type { MessageMeta, EmailAddress } from "@mailpoppy/core";
import { mail } from "./mailClient";

export interface Contact {
  address: string;
  name?: string;
}

let cache: Promise<Contact[]> | null = null;

export function loadContacts(selfEmail?: string): Promise<Contact[]> {
  if (!cache) cache = build(selfEmail);
  return cache;
}

export function resetContacts(): void {
  cache = null;
}

async function build(selfEmail?: string): Promise<Contact[]> {
  const self = (selfEmail ?? "").trim().toLowerCase();
  const acc = new Map<string, { name?: string; count: number; last: string }>();

  const add = (ea: EmailAddress | undefined, date: string) => {
    const address = ea?.address?.trim().toLowerCase();
    if (!address || address === self) return;
    const cur = acc.get(address) ?? { count: 0, last: "" };
    cur.count += 1;
    if (date > cur.last) cur.last = date;
    if (!cur.name && ea?.name) cur.name = ea.name;
    acc.set(address, cur);
  };

  try {
    const [inbox, sent] = await Promise.all([
      mail.list({ folder: "inbox", limit: 200 }),
      mail.list({ folder: "sent", limit: 200 }),
    ]);
    for (const m of inbox.items as MessageMeta[]) add(m.from, m.date);
    for (const m of sent.items as MessageMeta[]) for (const t of m.to ?? []) add(t, m.date);
  } catch {
    // Best-effort: autocomplete is a convenience, never block compose on it.
  }

  return [...acc.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[1].last < b[1].last ? 1 : -1))
    .map(([address, v]) => ({ address, name: v.name }));
}

/**
 * Suggestions for the recipient currently being typed. `token` is the text after
 * the last comma/semicolon/space; `chosen` are addresses already in the field
 * (excluded). Case-insensitive match on address or name. Returns at most `limit`.
 */
export function suggestContacts(
  contacts: Contact[],
  token: string,
  chosen: Set<string>,
  limit = 6,
): Contact[] {
  const q = token.trim().toLowerCase();
  if (!q) return [];
  const out: Contact[] = [];
  for (const c of contacts) {
    if (chosen.has(c.address)) continue;
    if (c.address.includes(q) || (c.name ?? "").toLowerCase().includes(q)) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}
