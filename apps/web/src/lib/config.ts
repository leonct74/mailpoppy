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
 * active. Sends only the domain, never the full address. On any failure falls back to
 * DEFAULT so sign-in still works against the launch deployment. (Phase B surfaces
 * inactive-subscription as a hard error instead of falling back.)
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
    }
  } catch {
    /* network/parse — fall back */
  }
  setActiveConfig(DEFAULT);
  return DEFAULT;
}
