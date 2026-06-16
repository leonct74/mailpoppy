// The shared API-Gateway client (from the desktop monorepo, via the submodule),
// wired to this app's deployment config and Cognito session. One instance is all
// the screens need.
import { MailpoppyClient } from "@mailpoppy/api-client";
import { getConfig, onConfigChange } from "./config";
import { auth } from "./auth";

// The deployment is resolved at sign-in, so the client is built lazily against the
// active config and rebuilt if the active deployment changes. A Proxy keeps the `mail`
// import stable for every screen.
let instance: MailpoppyClient | null = null;
onConfigChange(() => {
  instance = null;
});

function real(): MailpoppyClient {
  if (!instance) {
    instance = new MailpoppyClient({ apiBaseUrl: getConfig().apiBaseUrl, getToken: () => auth.getToken() });
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
