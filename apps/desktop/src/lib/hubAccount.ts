// Link from the desktop to the MailPoppy website's activation funnel. No accounts, auth or billing
// happen in the desktop — those all live on the website. The desktop only builds a URL that opens
// the pricing/activation page for a domain, carrying the domain's PUBLIC backend config so the
// website can register + activate it once the admin signs in (or signs up) there.

// Where the Hub lives. Override for staging via localStorage["mailpoppy.hubUrl"].
const HUB_URL = (
  (typeof localStorage !== "undefined" && localStorage.getItem("mailpoppy.hubUrl")) ||
  "https://mailpoppy.com"
).replace(/\/$/, "");

export interface DeploymentForHub {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

/** The /activate page URL for a domain, with its public backend config encoded for the website. */
export function activationUrl(domain: string, deployment: DeploymentForHub): string {
  const dep = btoa(JSON.stringify(deployment)); // all-public values; base64 just keeps the URL tidy
  return `${HUB_URL}/activate?${new URLSearchParams({ domain, dep }).toString()}`;
}
