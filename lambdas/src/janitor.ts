import type { ScheduledEvent } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DEFAULT_POLICY, type DeploymentPolicy, type MessageMeta } from "@mailpoppy/core";

/**
 * Scheduled (EventBridge) retention enforcement. Reads the retention policy and
 * purges Trash older than the window — the configurable "delete" behaviour
 * (DESIGN §10), more flexible than raw S3 lifecycle (never / per-domain windows).
 */
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const INDEX_TABLE = process.env.INDEX_TABLE ?? "";
const MAIL_BUCKET = process.env.MAIL_BUCKET ?? "";

// TODO(Phase 2+): load per-deployment / per-domain policy from the settings table.
function loadPolicy(): DeploymentPolicy {
  return DEFAULT_POLICY;
}

export async function handler(_event: ScheduledEvent): Promise<void> {
  const { retention } = loadPolicy();
  if (retention.mode === "never") return;

  const cutoff = new Date(Date.now() - retention.trashPurgeDays * 86_400_000).toISOString();
  let lastKey: Record<string, unknown> | undefined;
  let purged = 0;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: INDEX_TABLE,
        FilterExpression: "folder = :trash AND #d < :cutoff",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":trash": "trash", ":cutoff": cutoff },
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

  console.log(`janitor purged ${purged} trashed messages older than ${cutoff}`);
}
