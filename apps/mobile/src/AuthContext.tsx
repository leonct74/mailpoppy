import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth } from "./auth";
import { cognitoStorage } from "./cognitoStorage";
import { hydrateDeployment, resolveConfig } from "./config";
import { resetContacts } from "./contacts";
import { registerForPush, unregisterForPush } from "./push";

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
      if (res.status === "signed-in") await refresh();
      return res.status;
    },
    [refresh],
  );

  const completeNewPassword = useCallback(
    async (pw: string) => {
      await auth.completeNewPassword(pw);
      await refresh();
    },
    [refresh],
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
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
