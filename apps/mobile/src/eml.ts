// Parse a raw .eml (RFC 822) message into the fields the reader screen renders.
// The access API returns the raw message; postal-mime is a pure-JS parser that
// runs fine on Hermes/React Native (no Node Buffer needed).
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
  /** Best-effort plain-text body (falls back to HTML stripped of tags). */
  text: string;
  html: string | null;
  /** Message-ID header — used to thread replies (In-Reply-To / References). */
  messageId: string | null;
  /** Existing References header value, if any (for reply threading). */
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

/** Quick, dependency-free HTML→text fallback for messages with no text/plain part. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEml(eml: string): Promise<ParsedEmail> {
  const email = await new PostalMime().parse(eml);
  const html = email.html ?? null;
  const text = email.text && email.text.trim() ? email.text : html ? htmlToText(html) : "";
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
    text,
    html,
    messageId: email.messageId ?? null,
    references,
    attachments,
  };
}
