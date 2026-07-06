import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as Notifications from "expo-notifications";
import { auth } from "./auth";
import { cognitoStorage } from "./cognitoStorage";
import {
  hydrateDeployment,
  resolveConfig,
  refreshConfigForEmail,
  getConfigForEmail,
  setActiveDomain,
  adoptLegacyForDomain,
  knownDomains,
} from "./config";
import { resetContacts } from "./contacts";
import { clearInboxCaches } from "./inboxCache";
import { clearMessageCache } from "./messageCache";
import { hapticSwitch } from "./haptics";
import {
  registerForPush,
  registerForPushAllMailboxes,
  unregisterForMailbox,
  forgetRegisteredToken,
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
  /** All mailboxes added on this device (may span several domains). */
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
  // A LIVE mirror of {accounts, activeEmail} for background callbacks (selfHealStale) so they
  // recompute against current state instead of replaying a stale snapshot — which would clobber a
  // mailbox the user added during the self-heal's Hub round-trip.
  const stateRef = useRef<AccountsState>({ accounts: [], activeEmail: null });
  useEffect(() => {
    stateRef.current = { accounts, activeEmail };
  }, [accounts, activeEmail]);

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

      // Self-heal a mailbox whose BACKEND WAS REBUILT while the app held a saved session. A
      // teardown + redeploy makes a NEW Cognito pool, so the stored config (and the cached session
      // under the old client) is stale: the mailbox looks signed-in but can't open mail. Re-resolve
      // each mailbox's backend against the Hub; for any that genuinely changed, drop the dead
      // session/key and prompt a re-login for JUST those (Cognito needs the password, so there's no
      // seamless re-auth — but this replaces a silent break with a clear, targeted prompt, and never
      // touches the mailboxes that are fine). Runs in the background so it never delays startup.
      const selfHealStale = async (accts: MailboxAccount[]) => {
        if (accts.length === 0) return;
        // Re-resolve ONCE PER DOMAIN. Mailboxes on the same domain share one backend, and
        // refreshConfigForEmail mutates the shared stored config — so refreshing per-email would
        // race and miss the 2nd+ mailbox on a rebuilt domain (the first refresh already updated the
        // config it compares against). Check each domain once, then flag all its mailboxes.
        const oneEmailPerDomain = new Map<string, string>();
        for (const a of accts) {
          const d = domainOf(a.email);
          if (!oneEmailPerDomain.has(d)) oneEmailPerDomain.set(d, a.email);
        }
        let changedDomains: Set<string>;
        try {
          const checks = await Promise.all(
            [...oneEmailPerDomain].map(async ([d, em]) => ({ d, changed: (await refreshConfigForEmail(em)).changed })),
          );
          changedDomains = new Set(checks.filter((c) => c.changed).map((c) => c.d));
        } catch {
          return; // a resolve blip must never disturb a working session
        }
        const stale = accts.filter((a) => changedDomains.has(domainOf(a.email)));
        if (stale.length === 0) return;
        const staleSet = new Set(stale.map((a) => normaliseEmail(a.email)));
        for (const a of stale) {
          void unregisterForMailbox(a.username).catch(() => {});
          auth.signOutUser(a.username);
          forgetMailboxKey(a.email);
        }
        // Recompute against LIVE state (the user may have added/switched a mailbox during the
        // background Hub round-trip): drop the stale mailboxes from the CURRENT list, never replay
        // the restore snapshot. A mailbox added meanwhile on the same domain re-resolved its config
        // fresh, so it isn't in staleSet and correctly survives.
        const live = stateRef.current;
        const remaining = live.accounts.filter((a) => !staleSet.has(normaliseEmail(a.email)));
        if (remaining.length === 0) {
          clearAllMailboxKeys();
          resetContacts();
          auth.signOut();
          apply({ accounts: [], activeEmail: null });
          setStatus("signed-out");
        } else if (live.activeEmail && !staleSet.has(normaliseEmail(live.activeEmail))) {
          // The active mailbox survived — just drop the stale ones, leave the foreground alone.
          apply({ accounts: remaining, activeEmail: live.activeEmail });
        } else {
          // The active mailbox was stale — move the foreground to a surviving one.
          const nextActive = remaining[0]!;
          setActiveDomain(domainOf(nextActive.email));
          auth.setActiveUsername(nextActive.username);
          setActiveMailboxKey(nextActive.email);
          apply({ accounts: remaining, activeEmail: nextActive.email });
        }
        Alert.alert(
          stale.length === 1 ? "A mailbox needs to sign in again" : "Some mailboxes need to sign in again",
          `${stale.map((a) => a.email).join(", ")} ${stale.length === 1 ? "was" : "were"} rebuilt on the server, so the ` +
            `saved sign-in is no longer valid. Add ${stale.length === 1 ? "it" : "them"} again from the mailbox switcher to reconnect.`,
        );
      };

      // Bind every restored mailbox to its deployment so auth refreshes/signs each out
      // against the RIGHT Cognito pool — mailboxes may span several domains. Migration:
      // a pre-multi-domain install stored ONE config with no domain; bind it to the
      // active mailbox's domain (all its mailboxes shared that one domain), upgrading
      // storage to the map format in place.
      if (persisted.accounts.length > 0) {
        const activeAcct = persisted.accounts.find((a) => a.email === persisted.activeEmail) ?? persisted.accounts[0]!;
        adoptLegacyForDomain(domainOf(activeAcct.email)); // no-op on the new map format
        const known = new Set(knownDomains());
        for (const a of persisted.accounts) {
          if (known.has(domainOf(a.email))) {
            auth.registerMailbox(a.username, getConfigForEmail(a.email));
          } else {
            // Its backend config didn't persist (divergent writes) — don't silently bind
            // it to the launch pool and let it fail cryptically. Re-resolve in the
            // background and bind it then, restoring the foreground domain afterwards.
            void resolveConfig(a.email)
              .then((cfg) => auth.registerMailbox(a.username, cfg))
              .catch(() => {})
              .finally(() => setActiveDomain(domainOf(activeAcct.email)));
          }
        }
        setActiveDomain(domainOf(activeAcct.email)); // foreground the active mailbox's backend
      }

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
          void selfHealStale(persisted.accounts);
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
            adoptLegacyForDomain(domainOf(e)); // bind the single legacy config to this domain
            auth.registerMailbox(username, getConfigForEmail(e));
            auth.setActiveUsername(username);
            await restoreMailboxKeys([e]);
            setActiveMailboxKey(e);
            apply(migrated);
            setStatus("signed-in");
            void registerForPush();
            void selfHealStale(migrated.accounts);
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
      // Mailboxes on ANY paid domain are supported: resolve this domain's own backend
      // (throws ResolveError, leaving the active domain untouched, if the domain has no
      // active plan or isn't set up), then sign in against it.
      const prevActiveEmail = activeEmail;
      // resolveConfig already made addr's domain active; if the mailbox doesn't actually
      // get added (sign-in fails, or needs a first password set elsewhere), put the
      // foreground back where it was so the mailbox you were viewing isn't left pointed
      // at the wrong backend.
      const restoreForeground = () => {
        if (prevActiveEmail && domainOf(prevActiveEmail) !== domainOf(addr)) {
          setActiveDomain(domainOf(prevActiveEmail));
        }
      };
      const cfg = await resolveConfig(addr);
      try {
        const res = await auth.signIn(addr, pw);
        if (res.status === "new-password-required") {
          pendingEmail.current = addr;
          restoreForeground(); // not added yet — its password must be set elsewhere first
          return "new-password-required" as const;
        }
        const username = auth.lastAuthUsername();
        if (!username) throw new Error("Sign-in did not establish a session. Please try again.");
        auth.registerMailbox(username, cfg); // bind this mailbox to its backend
        auth.setActiveUsername(username);
        apply(withMailbox(state(), { email: addr, username }));
        setStatus("signed-in");
        await establishKeys(pw, addr);
        void registerForPush();
        return "signed-in" as const;
      } catch (e) {
        restoreForeground();
        throw e;
      }
    },
    [activeEmail, apply, establishKeys, state],
  );

  const completeNewPassword = useCallback(
    async (pw: string) => {
      await auth.completeNewPassword(pw);
      const addr = pendingEmail.current ?? normaliseEmail((await auth.currentEmail()) ?? "");
      pendingEmail.current = null;
      const username = auth.lastAuthUsername();
      if (!addr || !username) throw new Error("Couldn't finish setting up this mailbox. Please sign in again.");
      setActiveDomain(domainOf(addr)); // foreground this mailbox's backend (add may have restored another)
      auth.registerMailbox(username, getConfigForEmail(addr)); // its backend (resolved during add)
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
      setActiveDomain(domainOf(acct.email)); // foreground this mailbox's backend (may be another domain)
      auth.setActiveUsername(acct.username);
      setActiveMailboxKey(acct.email); // restore this mailbox's unlocked key (or lock)
      resetContacts(); // don't carry one mailbox's autocomplete into another
      apply(withActive(state(), addr));
      hapticSwitch();
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
        // it was active → move to the new active mailbox (possibly on another domain)
        const nextActive = next.accounts.find((a) => a.email === next.activeEmail);
        if (nextActive) {
          setActiveDomain(domainOf(nextActive.email));
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
    // Unregister the device token from EVERY mailbox's OWN backend (mailboxes can span
    // domains, each of which pushes independently) while the JWTs + deployment bindings
    // are still valid, THEN drop everything.
    void Promise.allSettled(toSignOut.map((u) => unregisterForMailbox(u))).finally(() => {
      forgetRegisteredToken();
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
