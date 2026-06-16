import type { Folder } from "@mailpoppy/core";

// Route params for the signed-in stack (React Navigation native-stack).
export type RootStackParamList = {
  Inbox: undefined; // the mailbox; folder is internal state (defaults to inbox)
  Message: { messageId: string; subject: string; from: string; folder: Folder };
  Settings: undefined; // account info + sign out

  Compose:
    | {
        to?: string;
        subject?: string;
        body?: string;
        inReplyTo?: string;
        references?: string;
        // Set when editing an existing draft — the screen loads its content and
        // save/send/discard act on this draft.
        draftId?: string;
      }
    | undefined;
};
