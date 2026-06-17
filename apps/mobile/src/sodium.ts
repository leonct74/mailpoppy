// Mobile libsodium binding for the shared, binding-agnostic crypto in
// @mailpoppy/core (see packages/core/src/mailboxCrypto.ts). On iOS/Android,
// react-native-libsodium runs the native libsodium C library over JSI, so the
// EXACT same Argon2id / X25519 / XSalsa20-Poly1305 primitives execute here as on
// the Node Lambda, the web app and the desktop (libsodium-wrappers-sumo). That
// byte-for-byte sameness is what lets a mailbox key generated on one device be
// unwrapped on another.
//
// react-native-libsodium "matches the libsodium-wrappers API", but two things
// differ in ways that would SILENTLY corrupt interop, so we handle them here
// rather than trust the library defaults:
//   1. base64 — the library defaults to URLSAFE_NO_PADDING; the rest of the
//      system uses ORIGINAL (standard, padded). We implement ORIGINAL base64
//      ourselves so the encoded blobs (publicKey, wrappedPrivateKey, salt, …)
//      are identical across platforms.
//   2. utf-8 — to_string/from_string go through TextEncoder/TextDecoder (already
//      polyfilled in polyfills.ts), which is plain UTF-8, matching from_string on
//      the other platforms.
// Everything else (the actual crypto + the byte-length constants) comes straight
// from the native library. On native, crypto_pwhash is available without
// loadSumoVersion and no `ready` await is required (those are react-native-web
// concerns); we still await `ready` defensively in case it resolves to a promise.
import * as RNLibsodium from "react-native-libsodium";
import type { Sodium } from "@mailpoppy/core";

// The library's .d.ts may not enumerate every constant we touch, so access it
// loosely — crypto correctness does not depend on the TS surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = RNLibsodium as unknown as Record<string, any>;

// ── ORIGINAL (standard, padded) base64 — independent of the library ──────────
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REV = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHA.length; i++) REV[ALPHA.charCodeAt(i)] = i;
// Accept URL-safe input too, so a blob encoded elsewhere still decodes.
REV["-".charCodeAt(0)] = 62;
REV["_".charCodeAt(0)] = 63;

function b64encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + "=";
  }
  return out;
}

/** Standard (padded) base64 of raw bytes — e.g. for FileSystem.writeAsStringAsync. */
export function bytesToBase64(bytes: Uint8Array): string {
  return b64encode(bytes);
}

function b64decode(str: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const v = REV[str.charCodeAt(i)];
    if (v === 255) continue; // skip '=', whitespace, newlines
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ── UTF-8 via the polyfilled TextEncoder/TextDecoder ─────────────────────────
function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Built AFTER `ready` resolves: libsodium-style bindings may leave the numeric
// constants unpopulated until then, so reading them at module-load could capture
// `undefined` (a silent, catastrophic failure — e.g. a zero-length salt). On
// native they're available immediately; building post-ready is just safe for all.
function buildSodium(): Sodium {
  const SALTBYTES = L.crypto_pwhash_SALTBYTES;
  const KEYBYTES = L.crypto_secretbox_KEYBYTES;
  const NONCEBYTES = L.crypto_secretbox_NONCEBYTES;
  if (!SALTBYTES || !KEYBYTES || !NONCEBYTES) {
    throw new Error("react-native-libsodium constants unavailable — is the native module linked?");
  }
  return {
    crypto_pwhash_SALTBYTES: SALTBYTES,
    crypto_pwhash_OPSLIMIT_INTERACTIVE: L.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    crypto_pwhash_MEMLIMIT_INTERACTIVE: L.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    // ARGON2ID13 is the fixed algorithm every platform derives with (value 2;
    // also the current DEFAULT). Fall back to the literal if it isn't exported.
    crypto_pwhash_ALG_ARGON2ID13: (L.crypto_pwhash_ALG_ARGON2ID13 ?? 2) as number,
    crypto_secretbox_KEYBYTES: KEYBYTES,
    crypto_secretbox_NONCEBYTES: NONCEBYTES,
    base64_variants: { ORIGINAL: 1 }, // nominal: our base64 always does ORIGINAL
    randombytes_buf: (n: number) => L.randombytes_buf(n),
    crypto_pwhash: (keyLen, password, salt, ops, mem, alg) => L.crypto_pwhash(keyLen, password, salt, ops, mem, alg),
    crypto_box_keypair: () => L.crypto_box_keypair(),
    crypto_box_seal: (m, pk) => L.crypto_box_seal(m, pk),
    crypto_box_seal_open: (c, pk, sk) => L.crypto_box_seal_open(c, pk, sk),
    crypto_secretbox_easy: (m, n, k) => L.crypto_secretbox_easy(m, n, k),
    crypto_secretbox_open_easy: (c, n, k) => L.crypto_secretbox_open_easy(c, n, k),
    to_base64: (input: Uint8Array) => b64encode(input),
    from_base64: (input: string) => b64decode(input),
    to_string: (bytes: Uint8Array) => utf8Decode(bytes),
    from_string: (str: string) => utf8Encode(str),
  };
}

let readyPromise: Promise<Sodium> | null = null;

/** The ready libsodium instance for this device (cached). */
export function getSodium(): Promise<Sodium> {
  if (!readyPromise) {
    readyPromise = Promise.resolve(L.ready).then(() => buildSodium());
  }
  return readyPromise;
}
