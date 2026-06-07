import type { ScheduledEvent } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_RETENTION,
  normalizeRetention,
  retentionSettingsKey,
  type RetentionSettings,
  type MessageMeta,
} from "@mailpoppy/core";

/**
 * Scheduled (EventBridge) retention enforcement (DESIGN §10). Reads the admin's
 * retention settings from the settings table and:
 *   - always purges Trash older than `trashPurgeDays` (deleted mail), and
 *   - if a `retentionDays` window is set, hard-deletes ANY message older than it
 *     in every folder (data-minimisation). Default = keep mail indefinitely.
 * More flexible than raw S3 lifecycle (per-deployment windows, never-delete).
 */
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? "";
const MAIL_BUCKET = process.env.MAIL_BUCKET ?? "";

/** Load retention settings; fail-safe to the keep-forever default on any problem. */
async function loadRetention(): Promise<RetentionSettings> {
  if (!SETTINGS_TABLE) return DEFAULT_RETENTION;
  try {
    const out = await ddb.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { pk: retentionSettingsKey() } }));
    const json = out.Item?.json;
    if (typeof json !== "string") return DEFAULT_RETENTION;
    return normalizeRetention(JSON.parse(json) as Partial<RetentionSettings>);
  } catch {
    return DEFAULT_RETENTION;
  }
}

/** Scan + hard-delete every row (and its S3 object) matching the filter. Returns the count. */
async function purge(
  filterExpression: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
): Promise<number> {
  let lastKey: Record<string, unknown> | undefined;
  let purged = 0;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: INDEX_TABLE,
        FilterExpression: filterExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const meta = item as unknown as MessageMeta & { pk: string; sk: string };
      if (meta.s3Key) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: MAIL_BUCKET, Key: meta.s3Key }))
          .catch((e) => console.error("s3 delete failed", meta.s3Key, e));
      }
      await ddb.send(new DeleteCommand({ TableName: INDEX_TABLE, Key: { pk: meta.pk, sk: meta.sk } }));
      purged += 1;
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return purged;
}

const daysAgoIso = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

export async function handler(_event: ScheduledEvent): Promise<void> {
  const retention = await loadRetention();

  // 1. Always purge Trash older than the window.
  const trashCutoff = daysAgoIso(retention.trashPurgeDays);
  const trashed = await purge(
    "folder = :trash AND #d < :cutoff",
    { "#d": "date" },
    { ":trash": "trash", ":cutoff": trashCutoff },
  );
  console.log(`janitor purged ${trashed} trashed messages older than ${trashCutoff}`);

  // 2. If a retention window is set, hard-delete ANY message older than it.
  if (retention.retentionDays !== null) {
    const cutoff = daysAgoIso(retention.retentionDays);
    const aged = await purge("#d < :cutoff", { "#d": "date" }, { ":cutoff": cutoff });
    console.log(`janitor enforced ${retention.retentionDays}d retention: deleted ${aged} messages older than ${cutoff}`);
  }
}
