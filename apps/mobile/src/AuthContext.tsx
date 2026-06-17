import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth } from "./auth";
import { cognitoStorage } from "./cognitoStorage";
import { hydrateDeployment, resolveConfig } from "./config";
import { resetContacts } from "./contacts";
import { registerForPush, unregisterForPush } from "./push";
import * as Notifications from "expo-notifications";
import { mail } from "./mailClient";
import { establishMailboxKeysForLogin, clearMailboxKeySession } from "./mailboxKeys";
import { KeyNoticeModal, type KeyNotice } from "./components/KeyNoticeModal";

type Status = "loading" | "signed-out" | "signed-in";

interface AuthState {
  status: Status;
  email: string | null;
  /** Returns "new-password-required" when an admin-created user must set a password. */
  signIn(email: string, password: string): Promise<"signed-in" | "new-password-required">;
  completeNewPassword(password: string): Promise<void>;
  /** Email the mailbox a password-reset code (forgot-password flow). */
  requestPasswordReset(email: string): Promise<void>;
  /** Finish the reset with the emailed code + a new password. */
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);

  // Unlock (or first-time generate) the mailbox encryption key while the
  // plaintext password is still in hand. Best-effort: a failure never blocks
  // sign-in — it surfaces a notice so the user knows encrypted mail may not open.
  const establishKeys = useCallback(async (pw: string) => {
    try {
      const r = await establishMailboxKeysForLogin(mail, pw);
      if (r.recoveryKey || r.rekeyed) setKeyNotice({ recoveryKey: r.recoveryKey, rekeyed: r.rekeyed });
    } catch (e) {
      setKeyNotice({ rekeyed: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const refresh = useCallback(async () => {
    if (auth.hasSession()) {
      try {
        const e = await auth.currentEmail();
        setEmail(e);
        setStatus("signed-in");
        // Register this device for new-mail push (best-effort, fire-and-forget).
        void registerForPush();
        return;
      } catch {
        // restored session was unusable — fall through to signed-out
      }
    }
    setEmail(null);
    setStatus("signed-out");
  }, []);

  // Restore the persisted deployment + session once, before the first auth check.
  useEffect(() => {
    void (async () => {
      await hydrateDeployment();
      await cognitoStorage.hydrate();
      await refresh();
    })();
  }, [refresh]);

  const signIn = useCallback(
    async (em: string, pw: string) => {
      const addr = em.trim().toLowerCase();
      await resolveConfig(addr); // resolve this domain's backend, then sign in against it
      const res = await auth.signIn(addr, pw);
      if (res.status === "signed-in") {
        await refresh();
        await establishKeys(pw);
      }
      return res.status;
    },
    [refresh, establishKeys],
  );

  const completeNewPassword = useCallback(
    async (pw: string) => {
      await auth.completeNewPassword(pw);
      await refresh();
      await establishKeys(pw);
    },
    [refresh, establishKeys],
  );

  const requestPasswordReset = useCallback(async (em: string) => {
    const addr = em.trim().toLowerCase();
    await resolveConfig(addr); // point at the right backend before emailing a reset code
    await auth.requestPasswordReset(addr);
  }, []);

  const confirmPasswordReset = useCallback(
    (em: string, code: string, pw: string) => auth.confirmPasswordReset(em.trim().toLowerCase(), code, pw),
    [],
  );

  const signOut = useCallback(() => {
    // Unregister the push token while the JWT is still valid, THEN drop the
    // session. Sign-out proceeds regardless of whether unregister succeeds.
    void unregisterForPush().finally(() => {
      auth.signOut();
      clearMailboxKeySession(); // drop the unlocked private key
      void Notifications.setBadgeCountAsync(0).catch(() => {}); // clear app-icon badge
      resetContacts(); // don't carry one mailbox's autocomplete into the next sign-in
      setEmail(null);
      setStatus("signed-out");
    });
  }, []);

  return (
    <Ctx.Provider
      value={{
        status,
        email,
        signIn,
        completeNewPassword,
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
