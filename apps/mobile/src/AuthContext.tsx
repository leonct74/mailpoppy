import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { auth } from "./auth";
import { cognitoStorage } from "./cognitoStorage";
import { hydrateDeployment, resolveConfig } from "./config";
import { resetContacts } from "./contacts";
import { clearInboxCaches } from "./inboxCache";
import { clearMessageCache } from "./messageCache";
import {
  registerForPush,
  unregisterForPush,
  registerForPushAllMailboxes,
  unregisterForMailbox,
} from "./push";
import { mail } from "./mailClient";
import {
  establishMailboxKeysForLogin,
  clearAllMailboxKeys,
  setActiveMailboxKey,
  forgetMailboxKey,
  restoreMailboxKeys,
} from "./mailboxKeys";
import {
  loadAccounts,
  saveAccounts,
  withMailbox,
  withoutMailbox,
  withActive,
  normaliseEmail,
  domainOf,
  type MailboxAccount,
  type AccountsState,
} from "./accounts";
import { KeyNoticeModal, type KeyNotice } from "./components/KeyNoticeModal";

type Status = "loading" | "signed-out" | "signed-in";

interface AuthState {
  status: Status;
  /** The active mailbox address (what most screens call `email`). */
  email: string | null;
  /** All mailboxes added on this device (v1: all on one domain). */
  accounts: MailboxAccount[];
  activeEmail: string | null;

  /** Add a mailbox and make it active (also the sign-in path for the first one).
   *  Returns "new-password-required" when an admin-created user must set a password. */
  addMailbox(email: string, password: string): Promise<"signed-in" | "new-password-required">;
  /** Back-compat alias for the login screen. */
  signIn(email: string, password: string): Promise<"signed-in" | "new-password-required">;
  completeNewPassword(password: string): Promise<void>;
  /** Switch which added mailbox is active (no network sign-in — reuses its session). */
  switchTo(email: string): Promise<void>;
  /** Remove one mailbox from this device (signs just it out). */
  removeMailbox(email: string): Promise<void>;

  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  /** Sign every mailbox out. */
  signOut(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [accounts, setAccounts] = useState<MailboxAccount[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);
  // The email whose new-password challenge is in flight (its address isn't in the
  // token yet), so completeNewPassword knows which mailbox it's finishing.
  const pendingEmail = useRef<string | null>(null);

  const apply = useCallback((next: AccountsState) => {
    setAccounts(next.accounts);
    setActiveEmail(next.activeEmail);
    void saveAccounts(next);
  }, []);

  const state = useCallback((): AccountsState => ({ accounts, activeEmail }), [accounts, activeEmail]);

  // Unlock (or first-time generate) the ACTIVE mailbox's encryption key while its
  // password is still in hand. Best-effort: a failure never blocks sign-in.
  const establishKeys = useCallback(async (pw: string, email: string) => {
    try {
      const r = await establishMailboxKeysForLogin(mail, pw, email);
      if (r.recoveryKey || r.rekeyed) setKeyNotice({ recoveryKey: r.recoveryKey, rekeyed: r.rekeyed });
    } catch (e) {
      setKeyNotice({ rekeyed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Restore the persisted deployment + mailbox list + sessions once, at startup.
  useEffect(() => {
    void (async () => {
      await hydrateDeployment();
      await cognitoStorage.hydrate();
      const persisted = await loadAccounts();

      // Multi-mailbox restore: point at the active mailbox and confirm its session
      // is still good before declaring signed-in.
      const active = persisted.accounts.find((a) => a.email === persisted.activeEmail);
      if (active) {
        auth.setActiveUsername(active.username);
        try {
          await auth.getToken();
          // Reload every mailbox's encryption key from the keychain BEFORE any
          // screen mounts, so a notification-tap cold start can decrypt right away.
          await restoreMailboxKeys(persisted.accounts.map((a) => a.email));
          setActiveMailboxKey(active.email);
          apply(persisted);
          setStatus("signed-in");
          void registerForPushAllMailboxes(persisted.accounts.map((a) => a.username));
          return;
        } catch {
          /* session expired → fall through */
        }
      }

      // Legacy single-session restore (installs from before multi-mailbox): adopt the
      // existing Cognito session into the accounts list so nobody gets logged out.
      if (auth.hasSession()) {
        try {
          const e = await auth.currentEmail();
          const username = auth.lastAuthUsername();
          if (e && username) {
            const migrated = withMailbox({ accounts: [], activeEmail: null }, { email: e, username });
            auth.setActiveUsername(username);
            await restoreMailboxKeys([e]);
            setActiveMailboxKey(e);
            apply(migrated);
            setStatus("signed-in");
            void registerForPush();
            return;
          }
        } catch {
          /* unusable → signed-out */
        }
      }

      setStatus("signed-out");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addMailbox = useCallback(
    async (em: string, pw: string) => {
      const addr = normaliseEmail(em);
      // v1 is same-domain only — refuse a mailbox on a different domain rather than
      // silently pointing at another backend and breaking the shared session model.
      if (accounts.length > 0 && domainOf(addr) !== domainOf(accounts[0]!.email)) {
        throw new Error(
          `This version supports mailboxes on one domain (@${domainOf(accounts[0]!.email)}). ${addr} is on a different domain.`,
        );
      }
      await resolveConfig(addr); // resolve this domain's backend, then sign in against it
      const res = await auth.signIn(addr, pw);
      if (res.status === "new-password-required") {
        pendingEmail.current = addr;
        return "new-password-required" as const;
      }
      const username = auth.lastAuthUsername();
      if (!username) throw new Error("Sign-in did not establish a session. Please try again.");
      auth.setActiveUsername(username);
      apply(withMailbox(state(), { email: addr, username }));
      setStatus("signed-in");
      await establishKeys(pw, addr);
      void registerForPush();
      return "signed-in" as const;
    },
    [accounts, apply, establishKeys, state],
  );

  const completeNewPassword = useCallback(
    async (pw: string) => {
      await auth.completeNewPassword(pw);
      const addr = pendingEmail.current ?? normaliseEmail((await auth.currentEmail()) ?? "");
      pendingEmail.current = null;
      const username = auth.lastAuthUsername();
      if (!addr || !username) throw new Error("Couldn't finish setting up this mailbox. Please sign in again.");
      auth.setActiveUsername(username);
      apply(withMailbox(state(), { email: addr, username }));
      setStatus("signed-in");
      await establishKeys(pw, addr);
      void registerForPush();
    },
    [apply, establishKeys, state],
  );

  const switchTo = useCallback(
    async (em: string) => {
      const addr = normaliseEmail(em);
      const acct = accounts.find((a) => a.email === addr);
      if (!acct || addr === activeEmail) return;
      auth.setActiveUsername(acct.username);
      setActiveMailboxKey(acct.email); // restore this mailbox's unlocked key (or lock)
      resetContacts(); // don't carry one mailbox's autocomplete into another
      apply(withActive(state(), addr));
    },
    [accounts, activeEmail, apply, state],
  );

  const removeMailbox = useCallback(
    async (em: string) => {
      const addr = normaliseEmail(em);
      const acct = accounts.find((a) => a.email === addr);
      if (!acct) return;
      void unregisterForMailbox(acct.username); // best-effort, before dropping the session
      auth.signOutUser(acct.username);
      forgetMailboxKey(acct.email);
      const next = withoutMailbox(state(), addr);
      apply(next);
      if (next.accounts.length === 0) {
        // removed the last one → fully signed out
        clearAllMailboxKeys();
        resetContacts();
        auth.signOut();
        setStatus("signed-out");
      } else if (addr === activeEmail) {
        // it was active → move to the new active mailbox
        const nextActive = next.accounts.find((a) => a.email === next.activeEmail);
        if (nextActive) {
          auth.setActiveUsername(nextActive.username);
          setActiveMailboxKey(nextActive.email);
          resetContacts();
        }
      }
    },
    [accounts, activeEmail, apply, state],
  );

  const requestPasswordReset = useCallback(async (em: string) => {
    const addr = normaliseEmail(em);
    await resolveConfig(addr); // point at the right backend before emailing a reset code
    await auth.requestPasswordReset(addr);
  }, []);

  const confirmPasswordReset = useCallback(
    (em: string, code: string, pw: string) => auth.confirmPasswordReset(normaliseEmail(em), code, pw),
    [],
  );

  const signOut = useCallback(() => {
    const toSignOut = accounts.map((a) => a.username);
    const emails = accounts.map((a) => a.email);
    // Unregister the active token while a JWT is still valid, THEN drop everything.
    void unregisterForPush().finally(() => {
      for (const u of toSignOut) auth.signOutUser(u);
      auth.signOut();
      clearAllMailboxKeys(emails); // wipes the keychain copies too
      void clearInboxCaches();
      void clearMessageCache();
      void Notifications.setBadgeCountAsync(0).catch(() => {});
      resetContacts();
      apply({ accounts: [], activeEmail: null });
      setStatus("signed-out");
    });
  }, [accounts, apply]);

  return (
    <Ctx.Provider
      value={{
        status,
        email: activeEmail,
        accounts,
        activeEmail,
        addMailbox,
        signIn: addMailbox,
        completeNewPassword,
        switchTo,
        removeMailbox,
        requestPasswordReset,
        confirmPasswordReset,
        signOut,
      }}
    >
      {children}
      <KeyNoticeModal notice={keyNotice} onDismiss={() => setKeyNotice(null)} />
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
