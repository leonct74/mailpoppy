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
  type Sodium,
  type MailboxKeyStore,
  type MailboxKeySession,
} from "@mailpoppy/core";

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
