// The four values the desktop app needs to talk to a deployed Mailpoppy backend.
// They are CloudFormation stack Outputs (see infra/lib/mail-stack.ts):
//   ApiBaseUrl, UserPoolId, UserPoolClientId, DeployRegion.
// Persisted locally so the admin enters them once.

export interface DeploymentConfig {
  apiBaseUrl: string;
  userPoolId: string;
  clientId: string;
  region: string;
}

const KEY = "mailpoppy.deployment";

export function loadDeploymentConfig(): DeploymentConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<DeploymentConfig>;
    if (c.apiBaseUrl && c.userPoolId && c.clientId && c.region) {
      return { apiBaseUrl: c.apiBaseUrl, userPoolId: c.userPoolId, clientId: c.clientId, region: c.region };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDeploymentConfig(c: DeploymentConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function clearDeploymentConfig(): void {
  localStorage.removeItem(KEY);
}
