// Mailbox-access authentication (DESIGN §6). This is the *mailbox plane*, not the
// provisioning plane: it never touches AWS admin credentials — the user signs in
// to the deployment's Cognito User Pool and we get a JWT, which the MailClient
// sends to API Gateway. amazon-cognito-identity-js does SRP client-side and works
// in the Tauri webview today and React Native later, so this module is portable.
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import type { DeploymentConfig } from "./deploymentConfig";

/**
 * Pull the `email` claim out of a Cognito ID token (JWT). When the pool uses
 * email as an *alias*, the token's username / `sub` is an opaque UUID, so the
 * `email` claim is the only reliable source of the mailbox address. Pure and
 * defensive — returns null on any malformed input. Exported for unit testing.
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

/** The surface LoginView depends on — so tests can inject a fake. */
export interface Authenticator {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Admin-created users must set a password on first sign-in. */
  completeNewPassword(newPassword: string): Promise<SignInResult>;
  /** A fresh id token (JWT), refreshing if needed. Rejects if signed out. */
  getToken(): Promise<string>;
  signOut(): void;
  hasSession(): boolean;
  /** The signed-in mailbox address, or null when signed out. Resolved from the
   *  ID-token claims, so it's the real email even when the pool uses email as an
   *  alias (username is then an opaque UUID). Works for restored sessions. */
  currentEmail(): Promise<string | null>;
}

export class CognitoAuth implements Authenticator {
  private readonly pool: CognitoUserPool;
  private pendingUser: CognitoUser | null = null;

  constructor(cfg: DeploymentConfig) {
    this.pool = new CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId });
  }

  signIn(email: string, password: string): Promise<SignInResult> {
    const user = new CognitoUser({ Username: email, Pool: this.pool });
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

  getToken(): Promise<string> {
    const user = this.pool.getCurrentUser();
    if (!user) return Promise.reject(new Error("not signed in"));
    return new Promise((resolve, reject) => {
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return reject(err ?? new Error("no session"));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  signOut(): void {
    this.pool.getCurrentUser()?.signOut();
    this.pendingUser = null;
  }

  hasSession(): boolean {
    return this.pool.getCurrentUser() != null;
  }

  async currentEmail(): Promise<string | null> {
    // The Cognito *username* is an opaque UUID when the pool uses email as an
    // alias, so getUsername() isn't the address — the email lives in the ID-token
    // claims. getToken() returns a fresh ID token (loading/refreshing the restored
    // session as needed), so this works after sign-in and across restarts.
    try {
      return emailFromJwt(await this.getToken());
    } catch {
      return null;
    }
  }
}
