import { describe, it, expect } from "vitest";
import { buildMimeMessage } from "./mime";

// Pull the base64 payload of the MIME part whose headers contain `marker`,
// decode it, and return the bytes. Verifies the attachment survives the build.
function decodePart(mime: string, marker: string): Buffer {
  // Split on a blank line into [headers, body] for each boundary section.
  const sections = mime.split(/\r\n--/);
  const section = sections.find((s) => s.includes(marker));
  if (!section) throw new Error(`no part containing ${marker}`);
  const idx = section.indexOf("\r\n\r\n");
  const body = section.slice(idx + 4);
  // Body runs until the next boundary delimiter (already split) — strip trailing.
  const b64 = body.replace(/\r\n/g, "").replace(/--.*$/s, "").trim();
  return Buffer.from(b64, "base64");
}

describe("buildMimeMessage", () => {
  const base = {
    from: "marco@ollydigital.com",
    to: ["someone@gmail.com"],
    subject: "Hello",
    messageId: "abc123@ollydigital.com",
    date: new Date("2026-06-03T10:00:00Z"),
  };

  it("builds a plain message with the right headers when there are no attachments", () => {
    const mime = buildMimeMessage({ ...base, text: "hi there" });
    expect(mime).toContain("From: marco@ollydigital.com");
    expect(mime).toContain("To: someone@gmail.com");
    expect(mime).toContain("Subject: Hello");
    expect(mime).toContain("Message-ID: <abc123@ollydigital.com>");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).not.toContain("multipart/mixed");
    // body round-trips
    expect(decodePart(mime, "text/plain").toString("utf8")).toBe("hi there");
  });

  it("wraps text+html in multipart/alternative", () => {
    const mime = buildMimeMessage({ ...base, text: "plain", html: "<b>rich</b>" });
    expect(mime).toContain("multipart/alternative");
    expect(decodePart(mime, "text/plain").toString("utf8")).toBe("plain");
    expect(decodePart(mime, "text/html").toString("utf8")).toBe("<b>rich</b>");
  });

  it("renders a Cc header but never a Bcc header", () => {
    const mime = buildMimeMessage({ ...base, text: "hi", cc: ["copy@x.com", "two@y.com"] });
    expect(mime).toContain("Cc: copy@x.com, two@y.com");
    // The Cc line sits between To and Subject (the ordering we emit).
    expect(mime.indexOf("To:")).toBeLessThan(mime.indexOf("Cc:"));
    expect(mime.indexOf("Cc:")).toBeLessThan(mime.indexOf("Subject:"));
    expect(mime).not.toMatch(/^Bcc:/im);
  });

  it("omits the Cc header when there are no cc recipients", () => {
    expect(buildMimeMessage({ ...base, text: "hi" })).not.toMatch(/^Cc:/im);
    expect(buildMimeMessage({ ...base, text: "hi", cc: [] })).not.toMatch(/^Cc:/im);
  });

  it("emits multipart/mixed with an attachment whose bytes round-trip exactly", () => {
    // A tiny PNG header (non-text bytes) to prove binary safety.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10, 0x42]);
    const mime = buildMimeMessage({
      ...base,
      text: "see attached",
      attachments: [{ filename: "photo.png", contentType: "image/png", bytes }],
    });

    expect(mime).toContain("Content-Type: multipart/mixed; boundary=");
    expect(mime).toContain('Content-Type: image/png; name="photo.png"');
    expect(mime).toContain('Content-Disposition: attachment; filename="photo.png"');
    expect(mime).toContain("Content-Transfer-Encoding: base64");

    // The attachment bytes survive the round-trip byte-for-byte.
    const out = decodePart(mime, "image/png");
    expect(Array.from(out)).toEqual(Array.from(bytes));
    // And the body part is still there.
    expect(decodePart(mime, "text/plain").toString("utf8")).toBe("see attached");
  });

  it("includes threading headers when provided", () => {
    const mime = buildMimeMessage({
      ...base,
      text: "re",
      inReplyTo: "<prev@x.com>",
      references: "<root@x.com> <prev@x.com>",
    });
    expect(mime).toContain("In-Reply-To: <prev@x.com>");
    expect(mime).toContain("References: <root@x.com> <prev@x.com>");
  });

  it("RFC 2047-encodes a non-ASCII subject", () => {
    const mime = buildMimeMessage({ ...base, subject: "Réunion 📎", text: "x" });
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).not.toContain("Subject: Réunion");
  });
});
