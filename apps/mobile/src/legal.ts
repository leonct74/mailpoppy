// Canonical Privacy Policy copy for the MailPoppy clients.
//
// KEEP IN SYNC with the web client's copy at
// mailpoppy-web/src/lib/legal.ts — the two must read identically. This is the
// single source the mobile app renders (PrivacyPolicy modal) and the basis for
// the consent gate on the login screen.
//
// Bump PRIVACY_VERSION whenever the policy changes materially — that forces
// every user to re-accept on next sign-in.

export const PRIVACY_VERSION = 1;
export const PRIVACY_LAST_UPDATED = "13 June 2026";

// The address users contact about the MailPoppy app itself (NOT about their
// mailbox — that's the domain administrator).
export const PRIVACY_CONTACT = "support@mailpoppy.com";

export const PRIVACY_INTRO =
  "This Privacy Policy explains how the MailPoppy app handles information — and, importantly, who actually runs the mailbox you sign in to. Please read the first two sections carefully.";

export type PolicyBlock = { p: string } | { ul: string[] };
export interface PolicySection {
  heading: string;
  blocks: PolicyBlock[];
}

export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    heading: "1. MailPoppy is an app, not your email provider",
    blocks: [
      {
        p: "MailPoppy is email software. When you sign in, the app connects you to a mailbox that runs entirely inside an Amazon Web Services (AWS) account that belongs to the administrator of your email domain — typically your employer, your organization, or whoever set up your email address for you.",
      },
      {
        p: "The makers of MailPoppy do not host your email. We operate no servers that receive, store, process, or have access to your messages, your password, or your mailbox. Your email and your sign-in never pass through MailPoppy's own systems, and we never see them.",
      },
      {
        p: "Because of this, MailPoppy — the app and the company that makes it — cannot read your email, cannot reset your password, and cannot access or recover your account. MailPoppy is not your email administrator and has no ability to reach your personal or work email. Those capabilities belong only to your domain administrator, described next.",
      },
    ],
  },
  {
    heading: "2. Your mailbox is provided and controlled by your domain administrator",
    blocks: [
      {
        p: 'Your email address and mailbox are issued to you by the administrator of your email domain (the "Administrator"). Your mailbox and all the email in it are stored in the Administrator\'s own AWS account and remain under the Administrator\'s control.',
      },
      {
        p: "You should be aware that the Administrator can, at any time and without further notice to you:",
      },
      {
        ul: [
          "reset or change your mailbox password;",
          "sign in to your mailbox; and",
          "read, search, export, or delete any email in your mailbox that has not been permanently deleted.",
        ],
      },
      {
        p: "Email that you permanently delete — including emptying it from Trash — is removed from the mailbox storage and is no longer available to the Administrator through MailPoppy, subject to any separate backups or retention the Administrator may keep.",
      },
      {
        p: "If you have questions about whether or how your mailbox is monitored, retained, or used, please ask your Administrator. MailPoppy cannot answer these questions, because MailPoppy has no access to your mailbox.",
      },
    ],
  },
  {
    heading: "3. Information the app uses on your device",
    blocks: [
      {
        p: "To show your mail, the app signs you in and communicates directly with your domain's mail service in the Administrator's AWS. On your device, the app stores only what is needed to keep you signed in and to display your mail — for example, a secure sign-in token, cached messages and contacts, and a record that you accepted this Privacy Policy. This information stays on your device and within the Administrator's AWS; it is not sent to MailPoppy.",
      },
    ],
  },
  {
    heading: "4. Push notifications (mobile app)",
    blocks: [
      {
        p: "If you allow notifications, the app registers a notification token so your domain's mail service can alert you about new mail. Notifications are delivered through your device platform's push service (Apple Push Notification service or Firebase Cloud Messaging) and the Expo push service. You can turn notifications off at any time in your device settings.",
      },
    ],
  },
  {
    heading: "5. No advertising or tracking by MailPoppy",
    blocks: [
      {
        p: "The MailPoppy app does not display advertising, does not include third-party advertising or analytics tracking SDKs, and does not track you across other apps or websites. MailPoppy does not sell your information.",
      },
    ],
  },
  {
    heading: "6. Children",
    blocks: [
      {
        p: "MailPoppy is intended for use with a mailbox issued by a domain administrator and is not directed to children.",
      },
    ],
  },
  {
    heading: "7. Changes to this policy",
    blocks: [
      {
        p: 'We may update this Privacy Policy from time to time. When we do, we will revise the "Last updated" date above. Significant changes may require you to accept the updated policy again before continuing to use the app.',
      },
    ],
  },
  {
    heading: "8. Contact",
    blocks: [
      {
        p: `For anything about your mailbox — how it is administered, monitored, retained, or accessed — contact your domain administrator, who controls the mailbox. For questions about the MailPoppy app itself, contact ${PRIVACY_CONTACT}.`,
      },
    ],
  },
];
