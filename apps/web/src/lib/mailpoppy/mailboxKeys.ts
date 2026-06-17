// Web binding for the mailbox-key lifecycle. The one place the webmail loads a
// libsodium implementation and holds the unlocked private key for the signed-in
// mailbox (in memory only — re-derived from the password at the next login,
// dropped on sign-out). Orchestration is the vendored core (mailboxKeySession).
import _sodium from "libsodium-wrappers-sumo";
import {
  establishMailboxKeys,
  type MailboxKeyStore,
  type MailboxKeySession,
} from "./mailboxKeySession";
import { unwrapContentKey, decryptWithContentKey, type Sodium } from "./mailboxCrypto";

/** The encryption fields the read path needs off a message (subset of MessageMeta). */
export interface EncryptedRef {
  encrypted?: boolean;
  encWrappedKey?: string;
}

let sodiumReady: Promise<Sodium> | null = null;
function getSodium(): Promise<Sodium> {
  if (!sodiumReady) sodiumReady = _sodium.ready.then(() => _sodium as unknown as Sodium);
  return sodiumReady;
}

let session: MailboxKeySession | null = null;

export function getMailboxKeySession(): MailboxKeySession | null {
  return session;
}

/** Drop the cached private key (call on sign-out). Best-effort zeroisation. */
export function clearMailboxKeySession(): void {
  session?.privateKey.fill(0);
  session = null;
}

export interface EstablishOutcome {
  created: boolean;
  rekeyed: boolean;
  recoveryKey?: string;
}

/** Generate / unwrap / re-key the mailbox keypair for a just-signed-in user and
 *  cache the private key. Call right after a successful sign-in. */
export async function establishMailboxKeysForLogin(
  store: MailboxKeyStore,
  password: string,
): Promise<EstablishOutcome> {
  const s = await getSodium();
  const r = await establishMailboxKeys(s, store, password);
  session = { publicKey: r.publicKey, privateKey: r.privateKey };
  return { created: r.created, rekeyed: r.rekeyed, recoveryKey: r.recoveryKey };
}

async function contentKeyForMessage(s: Sodium, meta: EncryptedRef): Promise<Uint8Array> {
  if (!session) throw new Error("Your mailbox is locked — sign in again to read this message.");
  return unwrapContentKey(s, session.publicKey, session.privateKey, meta.encWrappedKey!);
}

/** Decrypt an encrypted .eml back to plaintext MIME; a no-op for mail in clear. */
export async function decryptEml(meta: EncryptedRef, eml: string): Promise<string> {
  if (!meta.encrypted || !meta.encWrappedKey) return eml;
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return s.to_string(decryptWithContentKey(s, ck, eml));
}

/** Decrypt an encrypted attachment body (base64 ciphertext fetched from S3) to bytes. */
export async function decryptAttachmentBytes(meta: EncryptedRef, ciphertextB64: string): Promise<Uint8Array> {
  const s = await getSodium();
  const ck = await contentKeyForMessage(s, meta);
  return decryptWithContentKey(s, ck, ciphertextB64);
}
