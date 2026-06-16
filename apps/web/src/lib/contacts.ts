// Derived address book: contacts are inferred from people you've already
// corresponded with (Inbox senders + Sent recipients) — no separate storage.
// Powers the composer's To-field autocomplete. Fetched once per session and
// cached; reset on sign-out and after sending (so new correspondents appear).
import { mail } from "./mailClient";

export interface Contact {
  address: string;
  name?: string;
}

let cache: Promise<Contact[]> | null = null;

/** Lazily load (and cache) the derived contact list, ranked by frequency/recency. */
export function loadContacts(selfEmail?: string): Promise<Contact[]> {
  if (!cache) cache = build(selfEmail);
  return cache;
}

/** Drop the cache so the next load rebuilds (call on sign-out / after sending). */
export function resetContacts(): void {
  cache = null;
}

async function build(selfEmail?: string): Promise<Contact[]> {
  const self = (selfEmail ?? "").trim().toLowerCase();
  const acc = new Map<string, { name?: string; count: number; last: string }>();

  const add = (a: { name?: string; address?: string } | undefined, date?: string) => {
    const address = a?.address?.trim().toLowerCase();
    if (!address || !address.includes("@") || address === self) return;
    const cur = acc.get(address);
    if (cur) {
      cur.count += 1;
      if (a?.name && !cur.name) cur.name = a.name;
      if (date && date > cur.last) cur.last = date;
    } else {
      acc.set(address, { name: a?.name, count: 1, last: date ?? "" });
    }
  };

  try {
    const [inbox, sent] = await Promise.all([
      mail.list({ folder: "inbox", limit: 200 }),
      mail.list({ folder: "sent", limit: 200 }),
    ]);
    for (const m of inbox.items) add(m.from, m.date);
    for (const m of sent.items) for (const t of m.to ?? []) add(t, m.date);
  } catch {
    // best-effort: autocomplete simply has nothing to offer on error
  }

  return [...acc.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[1].last < b[1].last ? 1 : -1))
    .map(([address, v]) => ({ address, name: v.name }));
}
