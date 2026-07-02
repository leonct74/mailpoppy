// Which deployed MailPoppy backend the webmail talks to. PUBLIC client identifiers
// (Cognito User Pool ID, App Client ID, API Gateway URL) — not secrets.
//
// Multi-tenant: the active deployment is RESOLVED from the user's email domain at
// sign-in (via the Hub's /api/resolve) and persisted, so one app serves every
// customer. If resolution fails we fall back to DEFAULT (the launch deployment) so
// the live webmail never breaks. The auth/mail singletons rebuild via onConfigChange.
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
 * network/parse failures still fall back to DEFAULT so the webmail stays resilient.
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
    // Unlike the iOS app (Apple anti-steering), the web CAN say where to fix it —
    // the Login screen also renders a direct "Manage plan" link for this code.
    return (
      `MailPoppy isn't active for @${domain} — this domain's plan has lapsed or ` +
      `hasn't been activated. If you look after email for ${domain}, reactivate it ` +
      `from your account page; otherwise ask whoever does.`
    );
  }
  return (
    `We couldn't find MailPoppy set up for @${domain}. ` +
    `Double-check the address, or ask whoever looks after your email.`
  );
}

const DEFAULT: DeploymentConfig = {
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "eu-west-1",
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? "eu-west-1_yV09AF6Ja",
  clientId: process.env.NEXT_PUBLIC_CLIENT_ID ?? "361bkf3ja4ukgmqtgf17mbc37",
  apiBaseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://017dtrbes1.execute-api.eu-west-1.amazonaws.com",
};

const STORAGE_KEY = "mp_deployment";
const subscribers: Array<() => void> = [];
let active: DeploymentConfig | null = null;

function valid(c: unknown): c is DeploymentConfig {
  const d = c as Partial<DeploymentConfig> | null;
  return !!(d && d.region && d.userPoolId && d.clientId && d.apiBaseUrl);
}

function loadPersisted(): DeploymentConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (valid(c)) return c;
    }
  } catch {
    /* SSR or privacy-mode storage — fall back */
  }
  return null;
}

/** The deployment to use right now: resolved → persisted → DEFAULT fallback. */
export function getConfig(): DeploymentConfig {
  if (!active) active = loadPersisted();
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
  notify();
}

export function clearActiveConfig(): void {
  active = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

/**
 * Resolve which backend serves this email's domain (Hub /api/resolve) and make it
 * active. Sends only the domain, never the full address. A clear verdict from the Hub —
 * 403 (no active plan) or 404 (domain not set up) — throws a {@link ResolveError} the
 * sign-in screen turns into a plain-language, actionable message. Any OTHER failure
 * (network, parse, 5xx) falls back to DEFAULT so the live webmail never breaks.
 */
export async function resolveConfig(email: string): Promise<DeploymentConfig> {
  const domain = email.split("@").pop()?.trim().toLowerCase();
  if (!domain) {
    setActiveConfig(DEFAULT);
    return DEFAULT;
  }
  try {
    const res = await fetch(`/api/resolve?domain=${encodeURIComponent(domain)}`);
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
