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
    const res = await fetch(`${HUB_URL}/api/resolve?domain=${encodeURIComponent(domain)}`);
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
