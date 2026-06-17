// Desktop binding for the shared mailbox-key lifecycle (@mailpoppy/core).
//
// This is the one place the desktop app loads a libsodium implementation and
// holds the unlocked private key for the signed-in mailbox. The key lives ONLY
// in memory for the session: it's re-derived from the password at the next
// login and zeroised on sign-out. The orchestration (generate / unwrap / re-key)
// is shared with web + mobile — see mailboxKeySession.ts.
import _sodium from "libsodium-wrappers-sumo";
import {
  establishMailboxKeys,
  unwrapContentKey,
  decryptWithContentKey,
  type Sodium,
  type MailboxKeyStore,
  type MailboxKeySession,
} from "@mailpoppy/core";

/** The encryption fields the read path needs off a message (subset of MessageMeta). */
export interface EncryptedRef {
  encrypted?: boolean;
  encWrappedKey?: string;
}

// libsodium initialises asynchronously; reuse the one ready instance.
let sodiumReady: Promise<Sodium> | null = null;
function getSodium(): Promise<Sodium> {
  if (!sodiumReady) {
    sodiumReady = _sodium.ready.then(() => _sodium as unknown as Sodium);
  }
  return sodiumReady;
}

let session: MailboxKeySession | null = null;

/** The unlocked keypair for the signed-in mailbox, or null when signed out. */
export function getMailboxKeySession(): MailboxKeySession | null {
  return session;
}

/** Drop the cached private key (call on sign-out). Best-effort zeroisation. */
export function clearMailboxKeySession(): void {
  session?.privateKey.fill(0);
  session = null;
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
 * sign-in while the password is still in hand. Returns what the UI needs to show
 * the recovery key once (on first keygen) or warn about a re-key.
 */
export async function establishMailboxKeysForLogin(
  store: MailboxKeyStore,
  password: string,
): Promise<EstablishOutcome> {
  const s = await getSodium();
  const r = await establishMailboxKeys(s, store, password);
  session = { publicKey: r.publicKey, privateKey: r.privateKey };
  return { created: r.created, rekeyed: r.rekeyed, recoveryKey: r.recoveryKey };
}

// ── Read path: decrypt what the inbound Lambda sealed ────────────────────────

/** Recover the per-message content key from a message's wrap, using the cached
 *  private key. Throws a user-facing error if the mailbox is locked (signed out). */
async function contentKeyForMessage(s: Sodium, meta: EncryptedRef): Promise<Uint8Array> {
  if (!session) throw new Error("Your mailbox is locked — sign in again to read this message.");
  return unwrapContentKey(s, session.publicKey, session.privateKey, meta.encWrappedKey!);
}

/** Decrypt an encrypted .eml back to its plaintext MIME source; a no-op for mail
 *  stored in clear (received before activation, or with encryption off). */
export async function decryptEml(meta: EncryptedRef, eml: string): Promise<string> {
  if (!meta.encrypted || !meta.encWrappedKey) return eml;
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return s.to_string(decryptWithContentKey(s, ck, eml));
}

/** Decrypt an encrypted attachment body (the base64 ciphertext the client fetched
 *  from S3) back to raw bytes. For unencrypted messages, callers use the presigned
 *  URL directly and never reach this. */
export async function decryptAttachmentBytes(meta: EncryptedRef, ciphertextB64: string): Promise<Uint8Array> {
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return decryptWithContentKey(s, ck, ciphertextB64);
}
