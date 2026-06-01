import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { simpleParser } from "mailparser";
import type { MessageMeta } from "@mailpoppy/core";

/**
 * Triggered when SES writes a received .eml to S3. Parses MIME and writes the
 * "mailbox state" row to the DynamoDB index. This is where raw S3 objects become
 * an inbox (DESIGN §8 / §9.1). Skeleton — TODOs mark Phase 2 work.
 */
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const INDEX_TABLE = process.env.INDEX_TABLE ?? "";

export async function handler(event: S3Event): Promise<void> {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await obj.Body!.transformToString();
    const parsed = await simpleParser(raw);

    // TODO: derive domain/mailbox from the recipient; compute threadId from
    // References/In-Reply-To; apply the spam/virus/auth verdict policy (→ junk/reject).
    const meta: Partial<MessageMeta> = {
      messageId: parsed.messageId ?? key,
      subject: parsed.subject ?? "(no subject)",
      snippet: (parsed.text ?? "").slice(0, 140),
      date: (parsed.date ?? new Date()).toISOString(),
      hasAttachments: (parsed.attachments?.length ?? 0) > 0,
      folder: "inbox",
      flags: { unread: true },
      s3Key: key,
    };

    await ddb.send(
      new PutCommand({ TableName: INDEX_TABLE, Item: { pk: "TODO#mailbox", sk: `inbox#${meta.date}#${meta.messageId}`, ...meta } }),
    );
  }
}
