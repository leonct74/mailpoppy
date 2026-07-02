import type { Folder, MessageMeta } from "@mailpoppy/core";
import type { PickedAttachment } from "./attachments";

// Route params for the signed-in stack (React Navigation native-stack).
export type RootStackParamList = {
  Inbox: undefined; // the mailbox; folder is internal state (defaults to inbox)
  Message: {
    messageId: string;
    subject: string;
    from: string;
    folder: Folder;
    // Encryption fields (off MessageMeta) needed to decrypt the body/attachments
    // on the read screen. Absent ⇒ the message is stored in clear.
    encrypted?: boolean;
    encWrappedKey?: string;
  };
  Settings: undefined; // account info + sign out

  // A conversation (messages sharing a threadId), opened from a collapsed inbox
  // row. Receives a snapshot of the thread's messages from the listing.
  Thread: {
    subject: string;
    folder: Folder;
    messages: MessageMeta[];
  };

  Compose:
    | {
        to?: string;
        cc?: string;
        bcc?: string;
        subject?: string;
        body?: string;
        inReplyTo?: string;
        references?: string;
        // Set when editing an existing draft — the screen loads its content and
        // save/send/discard act on this draft.
        draftId?: string;
        // Set when an undone send reopens Compose — restores the picked files.
        attachments?: PickedAttachment[];
        // Skip the draft network load (an undone send passes content directly).
        skipDraftLoad?: boolean;
      }
    | undefined;
};
