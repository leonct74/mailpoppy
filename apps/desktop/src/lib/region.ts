// Desktop client for the sidecar's active AWS region. The admin picks where their
// mail infrastructure (and all stored mail) lives — data-residency matters for
// some jurisdictions. The choice is persisted locally and re-applied to the
// sidecar on launch (the sidecar starts from its env default otherwise).
import { sidecar } from "./sidecar";

export interface RegionConfig {
  region: string;
  available: string[];
}

export function getRegion(): Promise<RegionConfig> {
  return sidecar("/config/region");
}

export function setRegion(region: string): Promise<{ ok: true; region: string }> {
  return sidecar("/config/region", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region }),
  });
}

const KEY = "mailpoppy.region";

export function savedRegion(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function persistRegion(region: string): void {
  try {
    localStorage.setItem(KEY, region);
  } catch {
    /* ignore */
  }
}
