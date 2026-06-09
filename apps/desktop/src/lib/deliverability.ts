// Desktop client for the sidecar's "sending health" endpoint (admin-only — talks
// to the local sidecar with the admin's AWS credentials). Read-only.
import { sidecar } from "./sidecar";
import type { DeliverabilityOverview } from "@mailpoppy/core";

/**
 * Per-domain sending-health overview: an account-wide header (sending paused?,
 * daily quota, all-domains SES totals + do-not-send list) plus one row per domain
 * (sends, bounce/complaint counts + rates, do-not-send count).
 */
export function getDeliverabilityOverview(stackName: string): Promise<DeliverabilityOverview> {
  return sidecar(`/ses/deliverability/${encodeURIComponent(stackName)}`);
}
