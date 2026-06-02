import type { SNSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeAddress } from "@mailpoppy/core";

/**
 * SES bounce/complaint notifications arrive via SNS. We maintain a suppression
 * list (in the settings table, keyed `SUPPRESS#<address>`) so future sends skip
 * these recipients — mandatory once sending, or AWS throttles/suspends the
 * account (DESIGN §9.2 / §13). The access-API send path consults this list.
 */
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const SETTINGS_TABLE = process.env.SETTINGS_TABLE ?? "";

interface SesNotification {
  notificationType?: string;
  bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress?: string }[] };
  complaint?: { complainedRecipients?: { emailAddress?: string }[] };
}

async function suppress(address: string, reason: string, detail: string): Promise<void> {
  const addr = normalizeAddress(address);
  if (!addr) return;
  await ddb.send(
    new PutCommand({
      TableName: SETTINGS_TABLE,
      Item: { pk: `SUPPRESS#${addr}`, address: addr, reason, detail, suppressedAt: new Date().toISOString() },
    }),
  );
  console.log(`suppressed ${addr} (${reason}/${detail})`);
}

export async function handler(event: SNSEvent): Promise<void> {
  for (const rec of event.Records) {
    let n: SesNotification;
    try {
      n = JSON.parse(rec.Sns.Message) as SesNotification;
    } catch {
      console.error("unparseable SNS message");
      continue;
    }

    if (n.notificationType === "Bounce" && n.bounce) {
      const type = n.bounce.bounceType ?? "Unknown";
      // Only permanent bounces are suppressed; transient bounces may recover.
      if (type === "Permanent") {
        for (const r of n.bounce.bouncedRecipients ?? []) {
          if (r.emailAddress) await suppress(r.emailAddress, "bounce", type);
        }
      }
    } else if (n.notificationType === "Complaint" && n.complaint) {
      for (const r of n.complaint.complainedRecipients ?? []) {
        if (r.emailAddress) await suppress(r.emailAddress, "complaint", "abuse");
      }
    }
  }
}
