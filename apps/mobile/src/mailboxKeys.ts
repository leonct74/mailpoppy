// Mobile binding for the shared mailbox-key lifecycle (@mailpoppy/core).
//
// Holds the unlocked private key for the signed-in mailbox IN MEMORY for the
// session only: it's re-derived from the password at the next login and dropped
// on sign-out. The generate / unwrap / re-key orchestration is shared with
// desktop + web (mailboxKeySession.ts); this file just supplies the native
// libsodium instance (see sodium.ts) and the read-path decryption helpers.
import {
  establishMailboxKeys,
  unwrapContentKey,
  decryptWithContentKey,
  type Sodium,
  type MailboxKeyStore,
  type MailboxKeySession,
} from "@mailpoppy/core";
import { getSodium } from "./sodium";

/** The encryption fields the read path needs off a message (subset of MessageMeta). */
export interface EncryptedRef {
  encrypted?: boolean;
  encWrappedKey?: string;
}

// Several mailboxes can be added on this device (same domain), so we cache each
// unlocked keypair in memory keyed by its address, and track which one is ACTIVE
// (the mailbox currently being read). Switching mailboxes just re-points `active`
// at the already-unlocked session — no password needed — so decryption keeps
// working without re-signing-in. All are dropped on full sign-out; like the
// single-mailbox app, a cold restart starts with none until each is re-established.
const sessions = new Map<string, MailboxKeySession>();
let active: MailboxKeySession | null = null;

const norm = (email: string) => email.trim().toLowerCase();

/** The unlocked keypair for the ACTIVE mailbox, or null when locked/signed out. */
export function getMailboxKeySession(): MailboxKeySession | null {
  return active;
}

/** Make an already-added mailbox's key the active one (call on switch). If that
 *  mailbox has no cached key (e.g. after a cold restart), the mailbox reads as
 *  locked until it's re-established — same as the single-mailbox app. */
export function setActiveMailboxKey(email: string): void {
  active = sessions.get(norm(email)) ?? null;
}

/** Forget ONE mailbox's key (call when removing that mailbox). */
export function forgetMailboxKey(email: string): void {
  const s = sessions.get(norm(email));
  if (s) {
    s.privateKey.fill(0);
    sessions.delete(norm(email));
    if (active === s) active = null;
  }
}

/** Drop EVERY cached private key (call on full sign-out). Best-effort zeroisation. */
export function clearAllMailboxKeys(): void {
  for (const s of sessions.values()) s.privateKey.fill(0);
  sessions.clear();
  active = null;
}

/** Back-compat alias — clears all cached keys. */
export function clearMailboxKeySession(): void {
  clearAllMailboxKeys();
}

export interface EstablishOutcome {
  /** A keypair was generated this login (first login or a re-key). */
  created: boolean;
  /** The stored wrapping couldn't be opened (admin reset) → re-keyed; old mail is lost. */
  rekeyed: boolean;
  /** base64 recovery key to show ONCE — present only when `created`. */
  recoveryKey?: string;
}

/**
 * Establish (generate / unwrap / re-key) the mailbox keypair for a just-signed-in
 * user and cache the private key in memory. Call straight after a successful
 * sign-in / new-password challenge while the password is still in hand.
 */
export async function establishMailboxKeysForLogin(
  store: MailboxKeyStore,
  password: string,
  email: string,
): Promise<EstablishOutcome> {
  const s = await getSodium();
  const r = await establishMailboxKeys(s, store, password);
  const next: MailboxKeySession = { publicKey: r.publicKey, privateKey: r.privateKey };
  sessions.set(norm(email), next);
  active = next; // the mailbox we just signed into becomes the active one
  return { created: r.created, rekeyed: r.rekeyed, recoveryKey: r.recoveryKey };
}

// ── Read path: decrypt what the inbound Lambda sealed ────────────────────────

/** Recover the per-message content key from a message's wrap, using the cached
 *  private key. Throws a user-facing error if the mailbox is locked (signed out). */
async function contentKeyForMessage(s: Sodium, meta: EncryptedRef): Promise<Uint8Array> {
  if (!active) throw new Error("Your mailbox is locked — sign in again to read this message.");
  return unwrapContentKey(s, active.publicKey, active.privateKey, meta.encWrappedKey!);
}

/** Decrypt an encrypted .eml back to its plaintext MIME source; a no-op for mail
 *  stored in clear (received before activation, or with encryption off). */
export async function decryptEml(meta: EncryptedRef, eml: string): Promise<string> {
  if (!meta.encrypted || !meta.encWrappedKey) return eml;
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return s.to_string(decryptWithContentKey(s, ck, eml));
}

/** Decrypt an encrypted attachment body (the base64 ciphertext fetched from S3)
 *  back to raw bytes. For unencrypted messages, callers download the presigned URL
 *  directly and never reach this. */
export async function decryptAttachmentBytes(meta: EncryptedRef, ciphertextB64: string): Promise<Uint8Array> {
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return decryptWithContentKey(s, ck, ciphertextB64);
}
