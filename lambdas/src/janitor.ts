import type { ScheduledEvent } from "aws-lambda";
import { DEFAULT_POLICY } from "@mailpoppy/core";

/**
 * Scheduled (EventBridge) retention enforcement. Reads the per-deployment /
 * per-domain retention policy and purges Trash / expired mail accordingly —
 * the configurable "delete" behavior (DESIGN §10). More flexible than raw S3
 * lifecycle (supports never / legal-hold / per-domain windows).
 */
export async function handler(_event: ScheduledEvent): Promise<void> {
  const retention = DEFAULT_POLICY.retention; // TODO: load per-deployment/per-domain from settings table
  // TODO: scan the index for trashed/expired items per retention.mode +
  // retention.trashPurgeDays; delete the S3 object and the index row.
  void retention;
}
