import type { SNSEvent } from "aws-lambda";

/**
 * SES bounce/complaint notifications arrive via SNS. We maintain a suppression
 * list so we stop sending to addresses that bounce or complain — mandatory once
 * sending, or AWS throttles/suspends the account (DESIGN §9.2 / §13).
 */
export async function handler(event: SNSEvent): Promise<void> {
  for (const rec of event.Records) {
    const notification = JSON.parse(rec.Sns.Message) as {
      notificationType?: string;
      bounce?: unknown;
      complaint?: unknown;
    };
    // TODO: upsert bounced/complained recipients into the suppression store and
    // skip them on future sends.
    void notification;
  }
}
