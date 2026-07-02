// Undo-send: a message handed to "Send" waits here for a short grace period
// before it actually goes out, so a just-spotted typo or wrong recipient can be
// pulled back. Compose closes immediately; the snackbar (rendered at the app
// root) shows the countdown with an Undo button.
//
// The send is bound to the mailbox that composed it — a throwaway client using
// that mailbox's own token (same pattern as push registration) — so switching
// mailboxes during the grace period can never send from the wrong address. If
// the send ultimately fails, the message is saved as a draft in that mailbox
// (best-effort) so nothing is lost.
// Attachments are NOT uploaded until the grace period ends — so Compose closes
// instantly, and an undone message comes back with its attachments intact.
import { MailpoppyClient, type SendInput } from "@mailpoppy/api-client";
import { getConfig } from "./config";
import { auth } from "./auth";
import { hapticSend } from "./haptics";
import { uploadAttachmentToS3, type PickedAttachment } from "./attachments";

export const UNDO_SEND_MS = 5_000;

/** Everything needed to (re)send or reopen the message. */
export interface OutboxJob {
  input: Omit<SendInput, "attachments">;
  attachments: PickedAttachment[];
  username: string;
}

export type OutboxPhase = "waiting" | "sending" | "sent" | "failed";

export interface OutboxState {
  phase: OutboxPhase;
  /** ms remaining in the undo window (only meaningful while waiting). */
  remainingMs: number;
  /** Set when phase === "failed". */
  error?: string;
  /** True when the failed message was recovered into Drafts. */
  savedAsDraft?: boolean;
}

type Listener = (state: OutboxState | null) => void;
const listeners = new Set<Listener>();
let current: OutboxState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let pending: OutboxJob | null = null;

function emit(state: OutboxState | null) {
  current = state;
  for (const fn of listeners) fn(state);
}

/** Subscribe the snackbar; immediately receives the current state. */
export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function clientFor(username: string): MailpoppyClient {
  return new MailpoppyClient({
    apiBaseUrl: getConfig().apiBaseUrl,
    getToken: () => auth.getTokenFor(username),
  });
}

function clearTimers() {
  if (timer) clearTimeout(timer);
  if (ticker) clearInterval(ticker);
  timer = null;
  ticker = null;
}

async function dispatch() {
  const job = pending;
  pending = null;
  clearTimers();
  if (!job) return;
  emit({ phase: "sending", remainingMs: 0 });
  const client = clientFor(job.username);
  try {
    // Upload attachments straight to S3 (presigned PUT), then send referencing
    // their keys — deferred to now so Undo costs nothing and loses nothing.
    let attachments: { filename: string; contentType: string; s3Key: string }[] | undefined;
    if (job.attachments.length) {
      attachments = [];
      for (const a of job.attachments) {
        const { uploadUrl, key } = await client.presignAttachment({
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
        });
        await uploadAttachmentToS3(uploadUrl, a.uri, a.contentType);
        attachments.push({ filename: a.filename, contentType: a.contentType, s3Key: key });
      }
    }
    await client.send({ ...job.input, ...(attachments ? { attachments } : {}) });
    hapticSend();
    emit({ phase: "sent", remainingMs: 0 });
    setTimeout(() => {
      if (current?.phase === "sent") emit(null);
    }, 1_800);
  } catch (e) {
    // Don't lose the message: park it in that mailbox's Drafts (best-effort).
    let savedAsDraft = false;
    try {
      await client.saveDraft({
        draftId: job.input.draftId,
        to: job.input.to,
        subject: job.input.subject,
        text: job.input.text,
        inReplyTo: job.input.inReplyTo,
        references: job.input.references,
      });
      savedAsDraft = true;
    } catch {
      /* the error banner still shows */
    }
    emit({
      phase: "failed",
      remainingMs: 0,
      error: e instanceof Error ? e.message : String(e),
      savedAsDraft,
    });
  }
}

/**
 * Queue a message for sending after the undo window. Any message already waiting
 * is sent immediately first (one pending send at a time keeps Undo unambiguous).
 */
export function queueSend(job: OutboxJob): void {
  if (pending) void dispatch();
  pending = job;
  const deadline = Date.now() + UNDO_SEND_MS;
  emit({ phase: "waiting", remainingMs: UNDO_SEND_MS });
  timer = setTimeout(() => void dispatch(), UNDO_SEND_MS);
  ticker = setInterval(() => {
    const remaining = Math.max(0, deadline - Date.now());
    if (current?.phase === "waiting") emit({ phase: "waiting", remainingMs: remaining });
  }, 250);
}

/** Pull the waiting message back. Returns it so Compose can reopen with the
 *  content (attachments included), or null if the window already closed. */
export function undoSend(): OutboxJob | null {
  if (!pending) return null;
  const job = pending;
  pending = null;
  clearTimers();
  emit(null);
  return job;
}

/** Dismiss a settled (sent/failed) snackbar. */
export function dismissOutbox(): void {
  if (current?.phase === "sent" || current?.phase === "failed") emit(null);
}
