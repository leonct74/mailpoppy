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
import { getConfig, clearActiveConfig, type DeploymentConfig } from "./config";
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
  // One Cognito pool per deployment, cached by ClientId (a pool IS its user-pool +
  // client). Several coexist so a device can serve mailboxes across MULTIPLE domains.
  private pools = new Map<string, CognitoUserPool>();
  // Which deployment each mailbox session belongs to (by its storage username), so
  // token refresh / sign-out use the RIGHT pool regardless of which domain is active.
  private configByUsername = new Map<string, DeploymentConfig>();
  private pendingUser: CognitoUser | null = null;
  // The storage username (amazon-cognito `LastAuthUser`) of the mailbox the app is
  // currently acting as. When set, getToken() serves THIS mailbox's token even
  // though several mailboxes' sessions coexist in storage. Null falls back to the
  // library's "current user" (single-session / first-restore path).
  private activeUsername: string | null = null;

  /** Bind a mailbox's session to its deployment so refresh/sign-out hit the right pool.
   *  Call after a sign-in and for every restored mailbox at startup. */
  registerMailbox(username: string, config: DeploymentConfig): void {
    this.configByUsername.set(username, config);
    this.poolFor(config); // warm the pool
  }

  /** The deployment a mailbox belongs to, if we've registered it. */
  configFor(username: string): DeploymentConfig | null {
    return this.configByUsername.get(username) ?? null;
  }

  /** The cached pool for a config (one per ClientId), built on first use. */
  private poolFor(config: DeploymentConfig): CognitoUserPool {
    let pool = this.pools.get(config.clientId);
    if (!pool) {
      pool = new CognitoUserPool({
        UserPoolId: config.userPoolId,
        ClientId: config.clientId,
        Storage: cognitoStorage,
      });
      this.pools.set(config.clientId, pool);
    }
    return pool;
  }

  /** The pool for a specific mailbox username (its registered deployment), or the
   *  active deployment's pool when we don't know it yet (first sign-in). */
  private poolForUsername(username: string): CognitoUserPool {
    return this.poolFor(this.configByUsername.get(username) ?? getConfig());
  }

  /** The pool for the ACTIVE deployment (the foreground inbox's backend). */
  private activePool(): CognitoUserPool {
    return this.poolFor(getConfig());
  }

  /** amazon-cognito's per-pool `LastAuthUser` storage key. */
  private lastAuthKeyFor(clientId: string): string {
    return `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`;
  }

  /** The username the last successful sign-in cached its tokens under (whatever the
   *  library used — email or an opaque sub). Read straight after signIn (against the
   *  active pool) to record it. */
  lastAuthUsername(): string | null {
    return cognitoStorage.getItem(this.lastAuthKeyFor(getConfig().clientId));
  }

  /** Point the app at a specific mailbox's session (by its storage username). Also
   *  syncs that pool's `LastAuthUser` so getCurrentUser()/hasSession() agree with
   *  getToken(). Uses the mailbox's OWN deployment (not the active one) so it's correct
   *  even before the active domain has been switched to it. */
  setActiveUsername(username: string | null): void {
    this.activeUsername = username;
    if (username) {
      const clientId = (this.configByUsername.get(username) ?? getConfig()).clientId;
      cognitoStorage.setItem(this.lastAuthKeyFor(clientId), username);
    }
  }

  getActiveUsername(): string | null {
    return this.activeUsername;
  }

  /** A fresh ID token for a SPECIFIC mailbox (by storage username), refreshing if
   *  needed against THAT mailbox's pool. This is how one device serves several
   *  coexisting mailbox sessions, even across different domains. */
  getTokenFor(username: string): Promise<string> {
    const user = new CognitoUser({ Username: username, Pool: this.poolForUsername(username), Storage: cognitoStorage });
    return new Promise((resolve, reject) => {
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return reject(err ?? new Error("no session"));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  /** Sign ONE mailbox out (drop just its cached tokens), leaving the others intact. */
  signOutUser(username: string): void {
    const user = new CognitoUser({ Username: username, Pool: this.poolForUsername(username), Storage: cognitoStorage });
    user.signOut();
    if (this.activeUsername === username) this.activeUsername = null;
  }

  signIn(email: string, password: string): Promise<SignInResult> {
    const user = new CognitoUser({ Username: email, Pool: this.activePool(), Storage: cognitoStorage });
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
    const user = new CognitoUser({ Username: email, Pool: this.activePool(), Storage: cognitoStorage });
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
    const user = new CognitoUser({ Username: email, Pool: this.activePool(), Storage: cognitoStorage });
    return new Promise((resolve, reject) => {
      user.confirmPassword(code.trim(), newPassword, {
        onSuccess: () => resolve(),
        onFailure: (err) => reject(err),
      });
    });
  }

  /** A fresh ID token (JWT) for the ACTIVE mailbox, refreshing if needed. Rejects if
   *  signed out. Serves the active mailbox when several sessions coexist. */
  getToken(): Promise<string> {
    if (this.activeUsername) return this.getTokenFor(this.activeUsername);
    const user = this.activePool().getCurrentUser();
    if (!user) return Promise.reject(new Error("not signed in"));
    return new Promise((resolve, reject) => {
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return reject(err ?? new Error("no session"));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  signOut(): void {
    this.activePool().getCurrentUser()?.signOut();
    this.pendingUser = null;
    this.activeUsername = null;
    this.configByUsername.clear(); // forget every mailbox→deployment binding
    clearActiveConfig(); // clears every domain's config; next sign-in re-resolves
  }

  hasSession(): boolean {
    return this.activePool().getCurrentUser() != null;
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
