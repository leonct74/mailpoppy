// Which deployed MailPoppy backend(s) this app connects to. PUBLIC client identifiers
// (Cognito User Pool ID, App Client ID, API Gateway URL) — not secrets.
//
// Multi-tenant AND multi-domain: each email DOMAIN is its own backend deployment. A
// domain's config is RESOLVED from the user's email at sign-in (via the Hub's
// /api/resolve) and stored in a map keyed by domain, so ONE app can hold mailboxes
// across several paid domains at once and switch between them. `activeDomain` is the
// deployment the foreground inbox is looking at; per-mailbox background work (push,
// outbox, mark-read) resolves its OWN domain's config via getConfigForEmail/-Domain.
// If resolution fails we fall back to DEFAULT so the app still works against the launch
// deployment. The mail-client singleton rebuilds via onConfigChange when the active
// domain changes.
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
  // Both branches state that the domain needs an active plan and that the person who
  // manages its email turns it on — but NEITHER names or links an external place to buy
  // (Apple anti-steering, guideline 3.1.1). The admin who pays already knows where; a
  // tappable "Manage plan" link can be added post-review if wanted.
  if (code === "inactive_subscription") {
    // The domain IS registered with the Hub, but its plan isn't active.
    return (
      `The MailPoppy app isn't turned on for @${domain} yet — this domain needs an ` +
      `active plan. Ask whoever manages email for ${domain} to switch it on, then you ` +
      `can sign in here.`
    );
  }
  // unknown_domain: the domain isn't set up with MailPoppy at all. A domain only becomes
  // "known" to the Hub once its admin activates a plan for it, so MOST not-yet-activated
  // domains land here (not on the 403 above) — lead with the plan message so the user
  // understands what's needed. Keep a typo fallback, since a mistyped or non-MailPoppy
  // address lands here too.
  return (
    `MailPoppy isn't set up for @${domain} yet. To use the app on this domain it needs an ` +
    `active plan — ask whoever manages email for ${domain} to turn it on. ` +
    `(If that's not what you expected, double-check your email address for a typo.)`
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
// The multi-domain map. The legacy key held a single config (pre-multi-domain); it's
// migrated onto its domain at first restore (see adoptLegacyForDomain).
const STORAGE_KEY = "@mailpoppy/deployments";
const LEGACY_STORAGE_KEY = "@mailpoppy/deployment";

interface DeploymentState {
  /** Backend config per email domain (lower-cased). */
  configs: Record<string, DeploymentConfig>;
  /** The domain the foreground inbox is currently looking at. */
  activeDomain: string | null;
}

const subscribers: Array<() => void> = [];
let state: DeploymentState = { configs: {}, activeDomain: null };
// A single config restored from a pre-multi-domain install, not yet bound to a domain.
// getConfig() serves it until the restore flow binds it to the active mailbox's domain.
let legacy: DeploymentConfig | null = null;

function valid(c: unknown): c is DeploymentConfig {
  const d = c as Partial<DeploymentConfig> | null;
  return !!(d && d.region && d.userPoolId && d.clientId && d.apiBaseUrl);
}

/** Domain part of an address, lower-cased. */
function domainFromEmail(email: string): string {
  return (email.split("@").pop() ?? "").trim().toLowerCase();
}

function persist(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

/** Load persisted deployments once at startup (call before the first auth check). */
export async function hydrateDeployment(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeploymentState> | null;
      const configs: Record<string, DeploymentConfig> = {};
      if (parsed && parsed.configs && typeof parsed.configs === "object") {
        for (const [d, c] of Object.entries(parsed.configs)) if (valid(c)) configs[d.toLowerCase()] = c;
      }
      const active =
        parsed && typeof parsed.activeDomain === "string" && configs[parsed.activeDomain]
          ? parsed.activeDomain
          : (Object.keys(configs)[0] ?? null);
      state = { configs, activeDomain: active };
      return;
    }
    // Migration: an older install stored ONE config under the legacy key with no domain.
    // Keep it; the restore flow binds it to the active mailbox's domain.
    const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const c = JSON.parse(legacyRaw);
      if (valid(c)) legacy = c;
    }
  } catch {
    /* fall back to DEFAULT */
  }
}

/** The deployment the foreground inbox uses: active domain → legacy → DEFAULT fallback. */
export function getConfig(): DeploymentConfig {
  if (state.activeDomain && state.configs[state.activeDomain]) return state.configs[state.activeDomain];
  return legacy ?? DEFAULT;
}

/** The deployment serving a specific domain (for per-mailbox background work). */
export function getConfigForDomain(domain: string): DeploymentConfig {
  return state.configs[domain.trim().toLowerCase()] ?? legacy ?? DEFAULT;
}

/** The deployment serving a specific mailbox address. */
export function getConfigForEmail(email: string): DeploymentConfig {
  return getConfigForDomain(domainFromEmail(email));
}

/** Every domain we currently hold a backend config for. */
export function knownDomains(): string[] {
  return Object.keys(state.configs);
}

/** Register a callback fired whenever the active deployment changes (rebuild the client). */
export function onConfigChange(fn: () => void): void {
  subscribers.push(fn);
}

function notify() {
  for (const fn of subscribers) fn();
}

/** Store a domain's backend and make it the active one (sign-in / resolve). */
export function setActiveConfig(domain: string, c: DeploymentConfig): void {
  const d = domain.trim().toLowerCase();
  state.configs[d] = c;
  state.activeDomain = d;
  legacy = null; // superseded by the map
  persist();
  notify();
}

/** Switch which already-known domain is active (its config is already stored). No-op
 *  if we don't hold that domain's config yet. */
export function setActiveDomain(domain: string): void {
  const d = domain.trim().toLowerCase();
  if (!state.configs[d] || state.activeDomain === d) return;
  state.activeDomain = d;
  persist();
  notify();
}

/** Bind a pre-multi-domain single config onto its domain (once, at restore). No-op on
 *  the new map format (no legacy present). */
export function adoptLegacyForDomain(domain: string): void {
  if (legacy) setActiveConfig(domain, legacy);
}

/** Forget a domain's backend (e.g. its last mailbox on this device was removed). */
export function removeDomainConfig(domain: string): void {
  const d = domain.trim().toLowerCase();
  if (!state.configs[d]) return;
  delete state.configs[d];
  if (state.activeDomain === d) state.activeDomain = Object.keys(state.configs)[0] ?? null;
  persist();
  notify();
}

/** Clear ALL deployments (full sign-out); next sign-in re-resolves. */
export function clearActiveConfig(): void {
  state = { configs: {}, activeDomain: null };
  legacy = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  void AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
  notify();
}

/**
 * Resolve which backend serves this email's domain (Hub /api/resolve), store it under
 * that domain, and make it active. Sends only the domain, never the full address. A
 * clear verdict from the Hub — 403 (no active plan) or 404 (domain not set up) — throws
 * a {@link ResolveError} the sign-in screen turns into a plain-language, actionable
 * message (and leaves the active domain untouched, so a rejected add doesn't disturb the
 * mailbox you're viewing). Any OTHER failure (network, parse, 5xx) falls back to DEFAULT.
 */
export async function resolveConfig(email: string): Promise<DeploymentConfig> {
  const domain = domainFromEmail(email);
  if (!domain) {
    setActiveConfig("", DEFAULT);
    return DEFAULT;
  }
  try {
    const res = await fetch(`${HUB_URL}/api/resolve?domain=${encodeURIComponent(domain)}`);
    if (res.ok) {
      const c = await res.json();
      if (valid(c)) {
        setActiveConfig(domain, c);
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
  setActiveConfig(domain, DEFAULT);
  return DEFAULT;
}

const stripSlash = (s: string) => (s ?? "").replace(/\/+$/, "");

/** Two backend configs point at the SAME deployment. clientId/userPoolId/region are exact (Cognito
 *  ids are case-sensitive); apiBaseUrl is trailing-slash- and case-insensitive (host casing). */
const sameConfig = (a: DeploymentConfig, b: DeploymentConfig): boolean =>
  a.clientId === b.clientId &&
  a.userPoolId === b.userPoolId &&
  a.region === b.region &&
  stripSlash(a.apiBaseUrl).toLowerCase() === stripSlash(b.apiBaseUrl).toLowerCase();

/**
 * Re-resolve a mailbox's domain against the Hub and, if the backend has CHANGED (e.g. the domain
 * was torn down + redeployed → a NEW Cognito pool), update the stored config and report
 * `changed: true` so the caller can force a re-login — the cached session under the old pool is
 * dead, so the mailbox would otherwise look signed-in but be unable to open mail.
 *
 * Deliberately conservative: only reports a change when a config was ALREADY stored for the domain
 * AND the fresh one genuinely differs (client/pool/api/region). A missing config is adopted quietly
 * (not treated as stale), and a 403 / 404 / network error leaves everything untouched — so a plan
 * blip or being offline never disturbs a working mailbox. Does NOT change the active domain.
 */
export async function refreshConfigForEmail(email: string): Promise<{ changed: boolean }> {
  const domain = domainFromEmail(email);
  if (!domain) return { changed: false };
  const stored = state.configs[domain];
  try {
    const res = await fetch(`${HUB_URL}/api/resolve?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return { changed: false };
    const c = await res.json();
    if (!valid(c)) return { changed: false };
    // A stored config that's just the DEFAULT fallback (written when a sign-in couldn't reach the
    // Hub) is NOT a confirmed backend — adopt the real one quietly rather than mistaking the upgrade
    // for a rebuild and force-signing-out a working mailbox. Same for a domain with no cache yet.
    if (!stored || sameConfig(stored, DEFAULT)) {
      state.configs[domain] = c;
      persist();
      return { changed: false };
    }
    const changed = !sameConfig(stored, c);
    if (changed) {
      state.configs[domain] = c;
      persist();
    }
    return { changed };
  } catch {
    return { changed: false };
  }
}
