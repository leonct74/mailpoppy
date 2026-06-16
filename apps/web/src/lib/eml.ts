// Parse a raw .eml into the fields the reader renders. postal-mime is pure JS and
// runs in the browser. HTML bodies are sanitized + sandboxed at render time, not
// here (see components/webmail/Reader).
import PostalMime, { type Address } from "postal-mime";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
}

export interface ParsedEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  html: string | null;
  messageId: string | null;
  references: string | null;
  attachments: ParsedAttachment[];
}

function formatAddress(a: Address | undefined): string {
  if (!a) return "";
  const address = "address" in a ? (a.address ?? "") : "";
  const name = a.name ?? "";
  if (name && address) return `${name} <${address}>`;
  return name || address;
}

function formatAddresses(list: Address[] | undefined): string {
  return (list ?? []).map(formatAddress).filter(Boolean).join(", ");
}

export async function parseEml(eml: string): Promise<ParsedEmail> {
  const email = await new PostalMime().parse(eml);
  const references =
    (email.headers ?? []).find((h) => h.key.toLowerCase() === "references")?.value ?? null;
  const attachments = (email.attachments ?? []).map((a) => ({
    filename: a.filename || "attachment",
    mimeType: a.mimeType || "application/octet-stream",
  }));
  return {
    subject: email.subject ?? "(no subject)",
    from: formatAddress(email.from ?? undefined),
    to: formatAddresses(email.to),
    date: email.date ?? "",
    text: email.text ?? "",
    html: email.html ?? null,
    messageId: email.messageId ?? null,
    references,
    attachments,
  };
}

/** Bare address from a "Name <addr>" / "addr" string. */
export function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}
