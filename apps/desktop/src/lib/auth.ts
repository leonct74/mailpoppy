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
  /** The signed-in mailbox address, or null when signed out. Works for sessions
   *  restored across restarts (Cognito persists the last user in localStorage). */
  currentEmail(): string | null;
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

  currentEmail(): string | null {
    // Users sign in with their email as the Cognito username, so getUsername()
    // is the mailbox address. getCurrentUser() reads the persisted LastAuthUser,
    // so this resolves on a restored session without needing getSession().
    return this.pool.getCurrentUser()?.getUsername() ?? null;
  }
}
