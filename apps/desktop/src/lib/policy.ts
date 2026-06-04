// Desktop client for the sidecar's spam/auth policy endpoints (admin-only —
// talks to the local sidecar with the admin's AWS credentials). The policy
// (allow/block lists + per-verdict actions) is enforced by the inbound-processor
// Lambda, which reads it from the settings table (DESIGN §10).
import { sidecar } from "./sidecar";
import type { SpamPolicy } from "@mailpoppy/core";

/** Read the deployment's current mail-filtering policy (defaults if never set). */
export function getSpamPolicy(stackName: string): Promise<SpamPolicy> {
  return sidecar(`/policy/spam/${encodeURIComponent(stackName)}`);
}

/** Save the deployment's mail-filtering policy. */
export function setSpamPolicy(input: { stackName?: string; policy: SpamPolicy }): Promise<{ ok: true; policy: SpamPolicy }> {
  return sidecar("/policy/spam", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
