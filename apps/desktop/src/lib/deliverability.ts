// Desktop client for the sidecar's "sending health" endpoint (admin-only — talks
// to the local sidecar with the admin's AWS credentials). Read-only.
import { sidecar } from "./sidecar";
import type { DeliverabilityStatus } from "@mailpoppy/core";

/**
 * Read account-level sending health: bounce/complaint rates + sending quota from
 * SES, plus the do-not-send (suppression) list from the deployed stack.
 */
export function getDeliverability(stackName: string): Promise<DeliverabilityStatus> {
  return sidecar(`/ses/deliverability/${encodeURIComponent(stackName)}`);
}
