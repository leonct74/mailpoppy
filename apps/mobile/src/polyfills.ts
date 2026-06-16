// Polyfills that must exist BEFORE postal-mime loads. postal-mime parses the raw
// .eml of every message we open and assumes a browser-grade runtime; Hermes (the
// React Native engine) is missing two pieces it needs, and without them opening
// any email throws and the reader shows "Couldn't open this message":
//
//   1. TextEncoder / TextDecoder — postal-mime does `new TextEncoder()` at module
//      load and `new TextDecoder(charset)` per message. Hermes provides neither.
//   2. Blob — postal-mime's content decoders build `new Blob([...Uint8Array])` and
//      read it back via `blob.arrayBuffer()`. React Native's Blob supports neither
//      constructing from a typed array nor arrayBuffer() ("Creating blobs from
//      'ArrayBuffer' and 'ArrayBufferView' are not supported").
//
// IMPORTANT: imported at the very top of index.ts, before the app (and therefore
// postal-mime) is loaded, so the globals exist in time.
import { TextEncoder, TextDecoder as ZTextDecoder } from "@zxing/text-encoding";

const g = globalThis as unknown as { TextEncoder: unknown; TextDecoder: unknown; Blob: unknown };

// ---- TextEncoder / TextDecoder ------------------------------------------------
// @zxing decodes UTF-8 (the vast majority of mail) out of the box. Full legacy
// charset support (e.g. windows-1252) would require bundling its large index
// tables; we skip those to keep the app small and instead never throw: an
// unsupported charset falls back to UTF-8 — worst case a few mis-rendered accented
// characters in an old non-UTF-8 email, never a crashed message view.
class SafeTextDecoder {
  private readonly d: ZTextDecoder;
  constructor(label = "utf-8", options?: ConstructorParameters<typeof ZTextDecoder>[1]) {
    try {
      this.d = new ZTextDecoder(label, options);
    } catch {
      this.d = new ZTextDecoder("utf-8", options);
    }
  }
  get encoding(): string {
    return this.d.encoding;
  }
  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string {
    return this.d.decode(input as unknown as ArrayBuffer, options);
  }
}

g.TextEncoder = TextEncoder;
g.TextDecoder = SafeTextDecoder;

// ---- Blob ---------------------------------------------------------------------
// A minimal, in-memory, spec-shaped Blob backed by a single Uint8Array. Only the
// surface postal-mime touches is implemented (construct from parts + arrayBuffer);
// slice()/text() are included for completeness.
type BlobPart = string | ArrayBuffer | ArrayBufferView | InMemoryBlob;

class InMemoryBlob {
  private readonly bytes: Uint8Array;
  readonly size: number;
  readonly type: string;

  constructor(parts: BlobPart[] = [], options: { type?: string } = {}) {
    const chunks: Uint8Array[] = [];
    for (const part of parts) {
      if (part == null) continue;
      if (typeof part === "string") {
        chunks.push(new TextEncoder().encode(part));
      } else if (part instanceof InMemoryBlob) {
        chunks.push(part.bytes);
      } else if (part instanceof ArrayBuffer) {
        chunks.push(new Uint8Array(part.slice(0)));
      } else if (ArrayBuffer.isView(part)) {
        const v = part as ArrayBufferView;
        chunks.push(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
      } else {
        chunks.push(new TextEncoder().encode(String(part)));
      }
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.bytes = out;
    this.size = out.length;
    this.type = (options.type ?? "").toLowerCase();
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.bytes.buffer.slice(0, this.bytes.byteLength) as ArrayBuffer);
  }
  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(this.bytes));
  }
  slice(start = 0, end = this.size, type = ""): InMemoryBlob {
    return new InMemoryBlob([this.bytes.slice(start, end)], { type });
  }
}

// Only replace the native Blob when it can't do what postal-mime needs (it can't
// on React Native): construct from a typed array and expose arrayBuffer().
function nativeBlobIsUsable(): boolean {
  try {
    const b = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });
    return b.size === 3 && typeof (b as unknown as { arrayBuffer?: unknown }).arrayBuffer === "function";
  } catch {
    return false;
  }
}

if (!nativeBlobIsUsable()) {
  g.Blob = InMemoryBlob;
}
