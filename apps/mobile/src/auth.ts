// Mailbox-plane authentication. Mirrors the desktop app's CognitoAuth: the user
// signs in to the deployment's Cognito User Pool via SRP and we hand the resulting
// JWT to the API client. This NEVER touches AWS admin credentials — that's the
// desktop-only provisioning plane. The only RN-specific bit is the synchronous
// storage adapter (no localStorage on a phone).
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { getConfig, onConfigChange, clearActiveConfig } from "./config";
import { cognitoStorage } from "./cognitoStorage";

/**
 * Pull the `email` claim out of a Cognito ID token (JWT). When the pool uses
 * email as an alias, the username/`sub` is an opaque UUID, so the `email` claim is
 * the only reliable source of the mailbox address. Pure and defensive.
 */
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

export class CognitoAuth {
  private pool: CognitoUserPool | null = null;
  private pendingUser: CognitoUser | null = null;

  constructor() {
    // Rebuild the pool when the active deployment changes (a new domain resolved).
    onConfigChange(() => {
      this.pool = null;
      this.pendingUser = null;
    });
  }

  /** The Cognito pool for the active deployment, built lazily and rebuilt on change. */
  private getPool(): CognitoUserPool {
    if (!this.pool) {
      const c = getConfig();
      this.pool = new CognitoUserPool({
        UserPoolId: c.userPoolId,
        ClientId: c.clientId,
        Storage: cognitoStorage,
      });
    }
    return this.pool;
  }

  signIn(email: string, password: string): Promise<SignInResult> {
    const user = new CognitoUser({ Username: email, Pool: this.getPool(), Storage: cognitoStorage });
    const auth = new AuthenticationDetails({ Username: email, Password: password });
    return new Promise((resolve, reject) => {
      user.authenticateUser(auth, {
        onSuccess: () => resolve({ status: "signed-in", email }),
        onFailure: (err) => reject(err),
        newPasswordRequired: () => {
          this.pendingUser = user; // keep for completeNewPassword
          resolve({ status: "new-password-required", email });
        },
      });
    });
  }

  completeNewPassword(newPassword: string): Promise<SignInResult> {
    const user = this.pendingUser;
    if (!user) return Promise.reject(new Error("no pending password challenge"));
    return new Promise((resolve, reject) => {
      user.completeNewPasswordChallenge(
        newPassword,
        {},
        {
          onSuccess: () => {
            this.pendingUser = null;
            resolve({ status: "signed-in", email: user.getUsername() });
          },
          onFailure: (err) => reject(err),
        },
      );
    });
  }

  /**
   * Start a "forgot password" flow: Cognito emails a verification code to the
   * mailbox (its recovery is configured for email). Resolves once the code has
   * been sent; finish with confirmPasswordReset.
   */
  requestPasswordReset(email: string): Promise<void> {
    const user = new CognitoUser({ Username: email, Pool: this.getPool(), Storage: cognitoStorage });
    return new Promise((resolve, reject) => {
      user.forgotPassword({
        onSuccess: () => resolve(),
        inputVerificationCode: () => resolve(), // fired once the code email is on its way
        onFailure: (err) => reject(err),
      });
    });
  }

  /** Finish a "forgot password" flow with the emailed code + the new password. */
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
    const user = new CognitoUser({ Username: email, Pool: this.getPool(), Storage: cognitoStorage });
    return new Promise((resolve, reject) => {
      user.confirmPassword(code.trim(), newPassword, {
        onSuccess: () => resolve(),
        onFailure: (err) => reject(err),
      });
    });
  }

  /** A fresh ID token (JWT), refreshing the session if needed. Rejects if signed out. */
  getToken(): Promise<string> {
    const user = this.getPool().getCurrentUser();
    if (!user) return Promise.reject(new Error("not signed in"));
    return new Promise((resolve, reject) => {
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return reject(err ?? new Error("no session"));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  signOut(): void {
    this.getPool().getCurrentUser()?.signOut();
    this.pendingUser = null;
    clearActiveConfig(); // next sign-in re-resolves (also resets the pool via onConfigChange)
  }

  hasSession(): boolean {
    return this.getPool().getCurrentUser() != null;
  }

  /** The signed-in mailbox address (from ID-token claims), or null when signed out. */
  async currentEmail(): Promise<string | null> {
    try {
      return emailFromJwt(await this.getToken());
    } catch {
      return null;
    }
  }
}

export const auth = new CognitoAuth();
