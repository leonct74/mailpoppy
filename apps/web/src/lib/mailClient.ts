// The API client the webmail uses. The deployment is resolved at sign-in, so the
// client is built lazily (on first use) against the active config and rebuilt if the
// active deployment changes. A Proxy keeps the `mail` import stable for every screen.
import { MailpoppyClient } from "./mailpoppy/client";
import { getConfig, onConfigChange } from "./config";
import { getToken } from "./auth";

let instance: MailpoppyClient | null = null;
onConfigChange(() => {
  instance = null;
});

function real(): MailpoppyClient {
  if (!instance) {
    instance = new MailpoppyClient({ apiBaseUrl: getConfig().apiBaseUrl, getToken: () => getToken() });
  }
  return instance;
}

export const mail = new Proxy({} as MailpoppyClient, {
  get(_target, prop) {
    const r = real() as unknown as Record<PropertyKey, unknown>;
    const value = r[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(r) : value;
  },
}) as MailpoppyClient;
