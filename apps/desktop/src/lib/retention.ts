// Desktop client for the sidecar's retention settings (admin-only). How long mail
// is kept is enforced by the janitor Lambda, which reads these from the settings
// table (DESIGN §10).
import { sidecar } from "./sidecar";
import type { RetentionSettings } from "@mailpoppy/core";

export function getRetention(stackName: string): Promise<RetentionSettings> {
  return sidecar(`/policy/retention/${encodeURIComponent(stackName)}`);
}

export function setRetention(input: { stackName?: string; retention: RetentionSettings }): Promise<{ ok: true; retention: RetentionSettings }> {
  return sidecar("/policy/retention", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
