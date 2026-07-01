// Mobile binding for the shared mailbox-key lifecycle (@mailpoppy/core).
//
// Holds the unlocked private key for each added mailbox IN MEMORY, and — unlike
// desktop/web — also persists it in the DEVICE KEYCHAIN (expo-secure-store, i.e.
// iOS Keychain / Android Keystore). Phones cold-start constantly (notification
// taps, iOS reclaiming memory, app updates); without persistence every restart
// locked all mailboxes until each was re-added with its password, which broke
// the tap-a-notification → read-the-message flow. Hardware-backed, per-app
// keychain storage is the standard place for this. Keys are removed when a
// mailbox is removed / signed out. The generate / unwrap / re-key orchestration
// is shared with desktop + web (mailboxKeySession.ts); this file supplies the
// native libsodium instance (see sodium.ts) and the read-path decryption helpers.
import * as SecureStore from "expo-secure-store";
import {
  establishMailboxKeys,
  unwrapContentKey,
  decryptWithContentKey,
  bytesToB64,
  b64ToBytes,
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
// working without re-signing-in. All are dropped on full sign-out. After a cold
// restart, restoreMailboxKeys() reloads them from the keychain.
const sessions = new Map<string, MailboxKeySession>();
let active: MailboxKeySession | null = null;

const norm = (email: string) => email.trim().toLowerCase();

// ── Keychain persistence ──────────────────────────────────────────────────────

/** SecureStore keys may only contain [A-Za-z0-9.-_], so map the address into that. */
const keychainKey = (email: string) => "mbkey." + norm(email).replace(/[^A-Za-z0-9.\-_]/g, "_");

async function persistKey(email: string, session: MailboxKeySession): Promise<void> {
  try {
    const s = await getSodium();
    await SecureStore.setItemAsync(
      keychainKey(email),
      JSON.stringify({ pk: session.publicKey, sk: bytesToB64(s, session.privateKey) }),
    );
  } catch (e) {
    // Persistence is an enhancement — the in-memory session still works this run.
    console.warn("[keys] keychain save failed:", e);
  }
}

async function deletePersistedKey(email: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keychainKey(email));
  } catch {
    /* best-effort */
  }
}

/**
 * Reload the persisted keypairs for the given mailboxes into the in-memory cache
 * (call at startup, after loading the account list and BEFORE any screen decrypts).
 * A mailbox with no keychain entry simply stays locked until re-established.
 */
export async function restoreMailboxKeys(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  let s: Sodium;
  try {
    s = await getSodium();
  } catch {
    return;
  }
  for (const email of emails) {
    try {
      const raw = await SecureStore.getItemAsync(keychainKey(email));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { pk?: string; sk?: string };
      if (!parsed.pk || !parsed.sk) continue;
      sessions.set(norm(email), { publicKey: parsed.pk, privateKey: b64ToBytes(s, parsed.sk) });
    } catch (e) {
      console.warn("[keys] keychain restore failed for a mailbox:", e);
    }
  }
}

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

/** Forget ONE mailbox's key, in memory AND in the keychain (call when removing
 *  that mailbox). */
export function forgetMailboxKey(email: string): void {
  const s = sessions.get(norm(email));
  if (s) {
    s.privateKey.fill(0);
    sessions.delete(norm(email));
    if (active === s) active = null;
  }
  void deletePersistedKey(email);
}

/** Drop EVERY cached private key and its keychain copy (call on full sign-out).
 *  Pass the emails from the account list so entries whose in-memory session was
 *  never restored this run are wiped too. Best-effort zeroisation. */
export function clearAllMailboxKeys(emails: string[] = []): void {
  const toDelete = new Set([...emails.map(norm), ...sessions.keys()]);
  for (const s of sessions.values()) s.privateKey.fill(0);
  sessions.clear();
  active = null;
  for (const email of toDelete) void deletePersistedKey(email);
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
  void persistKey(email, next); // survive cold starts (notification taps, updates)
  return { created: r.created, rekeyed: r.rekeyed, recoveryKey: r.recoveryKey };
}

// ── Read path: decrypt what the inbound Lambda sealed ────────────────────────

/** Thrown when an encrypted message is opened but the active mailbox has no
 *  unlocked key — the reader catches this and offers an in-place unlock. */
export class MailboxLockedError extends Error {
  constructor() {
    super("This mailbox is locked on this device.");
    this.name = "MailboxLockedError";
  }
}

/** Recover the per-message content key from a message's wrap, using the cached
 *  private key. Throws MailboxLockedError if the mailbox is locked. */
async function contentKeyForMessage(s: Sodium, meta: EncryptedRef): Promise<Uint8Array> {
  if (!active) throw new MailboxLockedError();
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
