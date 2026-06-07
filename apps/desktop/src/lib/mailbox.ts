// Desktop client for the sidecar's mailbox (Cognito) endpoints. Mailboxes are
// users in the deployed backend's Cognito user pool; the sidecar resolves the
// pool from the stack's CloudFormation outputs.
import { sidecar } from "./sidecar";

export interface Mailbox {
  email: string;
  status: string;
  createdAt?: string;
}

/** The bits the Inbox tab needs to connect to the deployed backend. */
export interface BackendInfo {
  region: string;
  userPoolId: string;
  clientId: string;
  apiBaseUrl: string;
}

export function listMailboxes(
  stackName: string,
): Promise<BackendInfo & { ok: true; mailboxes: Mailbox[] }> {
  return sidecar(`/mailbox/list/${encodeURIComponent(stackName)}`);
}

export function createMailbox(input: {
  email: string;
  password: string;
  stackName?: string;
}): Promise<BackendInfo & { ok: true; mailbox: Mailbox }> {
  return sidecar(`/mailbox/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface MailboxDeletion {
  ok: true;
  email: string;
  userDeleted: boolean;
  deletedMessages: number;
  deletedObjects: number;
  freedBytes: number;
}

/** Permanently delete a mailbox: its sign-in user AND all its stored mail. */
export function deleteMailbox(input: { email: string; stackName?: string }): Promise<MailboxDeletion> {
  return sidecar(`/mailbox/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
