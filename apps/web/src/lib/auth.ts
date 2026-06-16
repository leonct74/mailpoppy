// Mailbox-plane auth for the browser. Signs in to the deployment's Cognito User
// Pool via SRP and yields a JWT for the API client. Browsers provide localStorage
// (Cognito's default session store) and crypto.getRandomValues natively, so no
// polyfills or custom storage are needed (unlike React Native).
//
// IMPORTANT: the user pool is created lazily (getPool) so importing this module is
// side-effect-free — it never touches localStorage during Next.js server rendering.
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { getConfig, onConfigChange, clearActiveConfig } from "./config";

let pool: CognitoUserPool | null = null;
// When the active deployment changes (a new domain resolved), drop the cached pool so
// the next call rebuilds it against the new Cognito User Pool.
onConfigChange(() => {
  pool = null;
  pendingUser = null;
});
function getPool(): CognitoUserPool {
  if (!pool) {
    const c = getConfig();
    pool = new CognitoUserPool({ UserPoolId: c.userPoolId, ClientId: c.clientId });
  }
  return pool;
}

/** Extract the `email` claim from a Cognito ID token (JWT). Pure and defensive. */
export function emailFromJwt(idToken: string): string | null {
  try {
    const part = idToken.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const claims = JSON.parse(atob(b64 + pad)) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export interface SignInResult {
  status: "signed-in" | "new-password-required";
  email: string;
}

let pendingUser: CognitoUser | null = null;

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: getPool() });
  const auth = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(auth, {
      onSuccess: () => resolve({ status: "signed-in", email }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        pendingUser = user;
        resolve({ status: "new-password-required", email });
      },
    });
  });
}

export function completeNewPassword(newPassword: string): Promise<SignInResult> {
  const user = pendingUser;
  if (!user) return Promise.reject(new Error("no pending password challenge"));
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(
      newPassword,
      {},
      {
        onSuccess: () => {
          pendingUser = null;
          resolve({ status: "signed-in", email: user.getUsername() });
        },
        onFailure: (err) => reject(err),
      },
    );
  });
}

/**
 * Start a "forgot password" flow: Cognito emails a verification code to the
 * mailbox (the pool's recovery is verified_email). Resolves once the code has
 * been sent; finish with confirmPasswordReset.
 */
export function requestPasswordReset(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.forgotPassword({
      onSuccess: () => resolve(),
      inputVerificationCode: () => resolve(), // fired once the code email is on its way
      onFailure: (err) => reject(err),
    });
  });
}

/** Finish a "forgot password" flow with the emailed code + the new password. */
export function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve, reject) => {
    user.confirmPassword(code.trim(), newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

/** A fresh ID token (JWT), refreshing the session if needed. Rejects if signed out. */
export function getToken(): Promise<string> {
  const user = getPool().getCurrentUser();
  if (!user) return Promise.reject(new Error("not signed in"));
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) return reject(err ?? new Error("no session"));
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function signOut(): void {
  getPool().getCurrentUser()?.signOut();
  pendingUser = null;
  clearActiveConfig(); // next sign-in re-resolves (also resets the pool via onConfigChange)
}

export function hasSession(): boolean {
  return getPool().getCurrentUser() != null;
}

export async function currentEmail(): Promise<string | null> {
  try {
    return emailFromJwt(await getToken());
  } catch {
    return null;
  }
}
