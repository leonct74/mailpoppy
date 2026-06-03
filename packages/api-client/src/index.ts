import type { MessageMeta, Folder, MessageFlags } from "@mailpoppy/core";

export interface MailpoppyClientConfig {
  /** Base URL of the deployment's API Gateway. */
  apiBaseUrl: string;
  /** Returns a fresh Cognito id token for the signed-in mailbox user. */
  getToken: () => Promise<string>;
}

export interface ListOptions {
  folder: Folder;
  limit?: number;
  cursor?: string;
}
export interface ListResult {
  items: MessageMeta[];
  cursor?: string;
}
export interface SendAttachment {
  filename: string;
  contentType: string;
  /** base64-encoded file bytes. */
  contentBase64: string;
}
export interface SendInput {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: SendAttachment[];
}
export interface MailboxUsage {
  email: string;
  usedBytes: number;
  messageCount: number;
  quotaBytes: number | null;
}

/**
 * Talks to the deployment's Cognito-authorized access API (API Gateway).
 * Shared by the desktop (React) and mobile (React Native) clients.
 * The mail path NEVER uses AWS credentials — only a Cognito JWT (DESIGN §6).
 */
export class MailpoppyClient {
  constructor(private readonly cfg: MailpoppyClientConfig) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.cfg.getToken();
    const res = await fetch(`${this.cfg.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Mailpoppy API ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  list(opts: ListOptions): Promise<ListResult> {
    const q = new URLSearchParams({ folder: String(opts.folder) });
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.cursor) q.set("cursor", opts.cursor);
    return this.req<ListResult>(`/messages?${q.toString()}`);
  }
  getRaw(messageId: string): Promise<{ eml: string }> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/raw`);
  }
  getAttachmentUrl(
    messageId: string,
    index: number,
  ): Promise<{ url: string; filename?: string; contentType?: string }> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/attachments/${index}`);
  }
  setFlags(messageId: string, flags: Partial<MessageFlags>): Promise<MessageMeta> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/flags`, {
      method: "PATCH",
      body: JSON.stringify(flags),
    });
  }
  move(messageId: string, folder: Folder): Promise<MessageMeta> {
    return this.req(`/messages/${encodeURIComponent(messageId)}/move`, {
      method: "POST",
      body: JSON.stringify({ folder }),
    });
  }
  send(input: SendInput): Promise<{ messageId: string }> {
    return this.req(`/send`, { method: "POST", body: JSON.stringify(input) });
  }
  getUsage(): Promise<MailboxUsage> {
    return this.req(`/usage`);
  }
}
