// Which deployed MailPoppy backend this app connects to. PUBLIC client identifiers
// (Cognito User Pool ID, App Client ID, API Gateway URL) — not secrets.
//
// Multi-tenant: the active deployment is RESOLVED from the user's email domain at
// sign-in (via the Hub's /api/resolve) and persisted, so one published app serves
// every customer. If resolution fails we fall back to DEFAULT so the app still works
// against the launch deployment. The auth/mail singletons rebuild via onConfigChange.
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface DeploymentConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

export type ResolveErrorCode = "inactive_subscription" | "unknown_domain";

/**
 * A definitive verdict from the Hub that this domain can't sign in yet — surfaced to
 * the user instead of silently falling back to the launch pool (which then failed at
 * Cognito with a baffling "user pool doesn't exist"). Only thrown on a clear 403/404;
 * network/parse failures still fall back to DEFAULT so the app stays resilient offline.
 */
export class ResolveError extends Error {
  constructor(
    readonly code: ResolveErrorCode,
    readonly domain: string,
    message: string,
  ) {
    super(message);
    this.name = "ResolveError";
  }
}

function resolveErrorMessage(code: ResolveErrorCode, domain: string): string {
  if (code === "inactive_subscription") {
    // Deliberately does NOT name or link an external purchase page (Apple anti-steering
    // 3.1.1). It states a plan is needed and who to ask — the admin who buys already
    // knows where. A tappable "Manage plan" link can be added post-review if wanted.
    return (
      `The MailPoppy mobile app isn't turned on for @${domain} yet — this domain needs ` +
      `an active plan. Ask whoever looks after email for ${domain} to switch it on, then ` +
      `you can sign in here.`
    );
  }
  return (
    `We couldn't find MailPoppy set up for @${domain}. ` +
    `Double-check the address, or ask whoever looks after your email.`
  );
}

const DEFAULT: DeploymentConfig = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? "eu-west-1",
  userPoolId: process.env.EXPO_PUBLIC_USER_POOL_ID ?? "eu-west-1_yV09AF6Ja",
  clientId: process.env.EXPO_PUBLIC_CLIENT_ID ?? "361bkf3ja4ukgmqtgf17mbc37",
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://017dtrbes1.execute-api.eu-west-1.amazonaws.com",
};

// The MailPoppy Hub (account/directory plane). Override for staging via env.
const HUB_URL = (process.env.EXPO_PUBLIC_HUB_URL ?? "https://mailpoppy.com").replace(/\/$/, "");
const STORAGE_KEY = "@mailpoppy/deployment";

const subscribers: Array<() => void> = [];
let active: DeploymentConfig | null = null;

function valid(c: unknown): c is DeploymentConfig {
  const d = c as Partial<DeploymentConfig> | null;
  return !!(d && d.region && d.userPoolId && d.clientId && d.apiBaseUrl);
}

/** Load the persisted deployment once at startup (call before the first auth check). */
export async function hydrateDeployment(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (valid(c)) active = c;
    }
  } catch {
    /* fall back to DEFAULT */
  }
}

/** The deployment to use right now: resolved → persisted → DEFAULT fallback. */
export function getConfig(): DeploymentConfig {
  return active ?? DEFAULT;
}

/** Register a callback fired whenever the active deployment changes (rebuild pools/clients). */
export function onConfigChange(fn: () => void): void {
  subscribers.push(fn);
}

function notify() {
  for (const fn of subscribers) fn();
}

export function setActiveConfig(c: DeploymentConfig): void {
  active = c;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c)).catch(() => {});
  notify();
}

export function clearActiveConfig(): void {
  active = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  notify();
}

/**
 * Resolve which backend serves this email's domain (Hub /api/resolve) and make it
 * active. Sends only the domain, never the full address. A clear verdict from the Hub —
 * 403 (no active plan) or 404 (domain not set up) — throws a {@link ResolveError} the
 * sign-in screen turns into a plain-language, actionable message. Any OTHER failure
 * (network, parse, 5xx) falls back to DEFAULT so the app still works offline / against
 * the launch deployment.
 */
export async function resolveConfig(email: string): Promise<DeploymentConfig> {
  const domain = email.split("@").pop()?.trim().toLowerCase();
  if (!domain) {
    setActiveConfig(DEFAULT);
    return DEFAULT;
  }
  try {
    const res = await fetch(`${HUB_URL}/api/resolve?domain=${encodeURIComponent(domain)}`);
    if (res.ok) {
      const c = await res.json();
      if (valid(c)) {
        setActiveConfig(c);
        return c;
      }
    } else if (res.status === 403 || res.status === 404) {
      // Definitive answer: don't fall back to the launch pool and fail later with a
      // cryptic Cognito error — tell the user exactly what's wrong and what to do.
      const code: ResolveErrorCode = res.status === 404 ? "unknown_domain" : "inactive_subscription";
      throw new ResolveError(code, domain, resolveErrorMessage(code, domain));
    }
  } catch (e) {
    if (e instanceof ResolveError) throw e; // definitive — surface it, don't swallow
    /* network/parse/5xx — fall back */
  }
  setActiveConfig(DEFAULT);
  return DEFAULT;
}
