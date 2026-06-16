# Store compliance — privacy, data safety, review notes, demo account

Everything the two stores ask about data + review, with paste-ready answers. Where a real
decision/credential is needed it's tagged **[you]**.

---

## 1. Demo / review account — [you] (REQUIRED)
Both Apple and Google reviewers must sign in, and the app has **no sign-up** (mailboxes are
provisioned by an admin). So you must give them a working login:

1. On the live backend (the one the build points at), create a demo mailbox, e.g.
   `reviewer@<your-domain>`, with a fixed password.
2. Send it 3–4 sample emails (one with an attachment) so the inbox isn't empty.
3. Put the email + password in **App Store Connect → App Review Information** and in
   **Play Console → … → App access** (mark the app as "All functionality requires sign-in" and
   provide the credentials).

Keep this mailbox alive — Apple re-checks it on every update.

## 2. Apple — App Review notes (paste into "Notes")
> MailPoppy is the mail client for an email service that customers host in their own cloud
> account. Users sign in to a mailbox their organisation's administrator created for them — there
> is intentionally no in-app sign-up, and the app sells nothing (no in-app purchases).
>
> Demo mailbox: username `<reviewer@your-domain>` / password `<…>`. It has sample mail to browse,
> compose, and an attachment to open.
>
> Account deletion: the app does not create accounts. Mailboxes are created and removed by the
> organisation's administrator (in the separate MailPoppy desktop app), so account deletion is
> handled by the administrator rather than in this client. Users can sign out from Settings.

## 3. Apple — App Privacy ("nutrition labels")
The developer collects **no** personal data for itself. Mail and credentials go only to the
user's own backend. One third-party flow to declare: **push notifications via Expo's Push
Service** (see §6).

Recommended answers:
- **Contact Info / User Content / Search / Browsing / Location / Financial / Health / Contacts**: **Not collected.**
- **Identifiers → Device ID**: **Collected** → purpose **App Functionality** (the push token used
  to deliver "new mail" notifications) → **Not** used for tracking → **Not** linked to the user's identity.
- "Do you use data for tracking?" → **No.**

(If you move push off Expo to direct APNs/FCM, or disable push, you can answer "Data Not
Collected" across the board.)

## 4. Google — Data safety form
- **Does your app collect or share any of the required user data types?** Yes — minimal (push token only).
  - Data type: **Device or other IDs** → collected, **not** shared, purpose **App functionality**.
  - Everything else (messages, contacts, photos, location, personal info): **not collected** by the
    developer. (Email lives in the user's own cloud; attachments are picked on-device.)
- **Is all data encrypted in transit?** **Yes** (HTTPS/TLS to the backend and push service).
- **Can users request data deletion?** Yes — via their administrator (who manages the mailbox).
  Provide a contact: `support@mailpoppy.com`.

## 5. Content rating
Email client; the app contains no objectionable content of its own (users send/receive their own
mail). Answer the questionnaires "No" to violence/sexual/drugs/gambling etc.
- Apple: expect **4+**.
- Google (IARC): expect **Everyone**.

## 6. Push notifications go through Expo — [you] decision
`src/push.ts` uses `getExpoPushTokenAsync`, so the device push token and each "new mail"
notification's **payload** are sent to **Expo's Push Service** (a third party) for delivery. Two
implications:
- **Privacy forms**: declare the Device ID as above (already covered).
- **The "nothing passes through anyone else" claim**: if the notification payload includes the
  sender or subject, that snippet transits Expo. **Recommendation:** keep push payloads
  content-light (e.g. just "You have new mail") so no message content leaves the user's cloud —
  verify what the inbound-processor Lambda puts in the payload. (Longer term, direct APNs/FCM
  removes the Expo hop entirely.) This doesn't block submission; it's a privacy-posture call.

## 7. Roadmap note (context, not a store field)
This first release is **single-tenant** — it connects to the one backend baked into
`src/config.ts`. Email-domain → backend resolution (so any customer's users can sign in) is the
next build; because it's a JS/config change it can ship to installed apps via an over-the-air
update without a reinstall. Until then, the published app serves mailboxes on the current
deployment (fine for launch + marketing + the demo reviewer login).
