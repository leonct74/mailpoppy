# Multi-mailbox in the mobile app — design spec (draft)

**Status:** proposed · **Author:** design pass · **Scope decision owed before build**

## 1. Why

The mobile app is the paid tier, and the tier is priced **per domain** — one price already
covers *every* mailbox on that domain. But today the app is **single-account**: you sign in to
one mailbox, and to read another you sign out and sign back in. The canonical customer — a small
operator running `sales@`, `support@`, `enquiries@` on one domain — does that many times a day.

Letting one person hold several mailboxes in the app (with notifications from all of them) is the
app finally delivering what the per-domain price already promises. It is the single biggest lever
on "is the mobile app worth paying for?"

## 2. Scope

**v1 (this spec): multiple mailboxes on the *same domain*.**
- All mailboxes on one domain share the **same backend and the same Cognito user pool**, so the
  deployment config (`region/userPoolId/clientId/apiBaseUrl`) is *identical* across them. That is
  the key simplification — only the *signed-in user* changes, not the backend. This covers the
  entrepreneur case exactly.
- UX: an **account switcher + a per-mailbox inbox** (you are always clearly "in" one mailbox).
  **Notifications arrive from all added mailboxes** and a tap opens the right one.

**Non-goals for v1 (later phases):**
- Mailboxes across *different domains* (multiple backends/pools) — harder; deferred to v2.
- A merged "unified inbox" view (all mailboxes in one list) — deferred; the switcher solves the
  pain with far less risk and keeps "reply from the right address" unambiguous.

## 3. Current architecture (the constraints)

| Piece | File | Today (single-account) |
|---|---|---|
| Auth | `src/auth.ts` | `CognitoAuth` singleton with one `pool` from `getConfig()`; one "current" session in `cognitoStorage`. |
| Session store | `src/cognitoStorage.ts` | AsyncStorage-mirrored map; amazon-cognito keys are already per-username, so several users' tokens *can* coexist. |
| Auth state | `src/AuthContext.tsx` | Holds one `email` + `status`; `signOut` wipes keys + contacts + push token. |
| Config | `src/config.ts` | One active `DeploymentConfig`, persisted. |
| Mail client | `src/mailClient.ts` | "One instance is all" — bound to the active config + session. |
| Push | `src/push.ts` | Registers this device's Expo token against the active mailbox's backend; unregisters on sign-out. |
| Keys | `src/mailboxKeys.ts` | One unlocked mailbox key session; cleared on sign-out. |
| Contacts | `src/contacts.ts` | Cached for the active mailbox; reset on sign-out. |
| Screens | `src/screens/*` | Inbox / Message / Compose / Settings / Login. |

## 4. The model change

Introduce an **accounts list** with an **active** pointer, all sharing one deployment:

```ts
interface MailboxAccount {
  email: string;            // e.g. support@yourdomain.com
  // session tokens already live in cognitoStorage, keyed by username — no duplication here
}
interface MultiAuthState {
  deployment: DeploymentConfig;   // shared by all (same domain)
  accounts: MailboxAccount[];     // persisted list of added mailboxes
  activeEmail: string | null;
  addMailbox(email, password): Promise<...>;   // sign in, persist, register push, DON'T sign others out
  switchTo(email): Promise<void>;              // rebuild client + keys + contacts for that mailbox
  removeMailbox(email): Promise<void>;          // unregister its push, drop its session, forget it
  signOutAll(): void;
}
```

Switching = point `auth`/`mail` at the chosen username's stored session, unlock that mailbox's
key, load its contacts. No network sign-in needed if the stored session is still valid (refresh
token), so switching is fast.

## 5. Component-by-component

- **`auth.ts`** — make the pool reusable but let callers act as a chosen username: `getSession(email)`
  reads that user's tokens from `cognitoStorage` (already per-username). Add `listStoredUsers()`.
  Keep `signIn` for *adding* a mailbox.
- **`AuthContext.tsx`** — replace single `email` with `accounts` + `activeEmail`; `addMailbox`
  (does today's `signIn` flow but appends instead of replacing), `switchTo`, `removeMailbox`. On
  switch: `clearMailboxKeySession()` → re-`establishMailboxKeys` for the new mailbox; `resetContacts()`.
- **`config.ts`** — unchanged for v1 (one shared deployment). (v2: a config per domain.)
- **`mailClient.ts`** — must target the active session. Simplest: it already reads the active
  session; on `switchTo` we set the active user then let `onConfigChange`/a new "onAccountChange"
  signal rebuild it.
- **`push.ts`** — **register the device token for *each* added mailbox** (call `registerDevice`
  while each is the active session, or add a backend call that registers a token for a list of
  mailboxes). On `removeMailbox`, unregister that mailbox only. This is what makes notifications
  arrive for all three inboxes.
- **`mailboxKeys.ts` / `contacts.ts`** — keep them per-active-mailbox (re-established on switch).
  Optional later: cache multiple unlocked key sessions so switching doesn't re-derive.
- **Compose** — default "from" = active mailbox; allow choosing among the added mailboxes.

## 6. Notifications (the actual value) — backend is ALREADY multi-mailbox ready ✅

Verified in `lambdas/src/inbound-processor.ts` + `packages/core/src/push.ts`:
- The device-token registry is stored **per mailbox address** (`devicesSettingsKey(address)`), and
  new-mail push is sent **per recipient mailbox** (`notifyNewMail(recipient, …)`).
- The push payload **already carries the recipient mailbox** — `data: { messageId, mailbox:
  recipient, folder, threadId }`. So no Lambda/infra change is needed.

That means multi-mailbox notifications are a **purely client-side** feature. The app only needs to:
1. **Register the device's Expo token under each added mailbox** — i.e. call `mail.registerDevice`
   once per mailbox (authenticated as each), so all three inboxes push to this device.
2. **Route on `data.mailbox`** — a notification tap → `switchTo(data.mailbox)` → open `data.messageId`;
   and maintain a per-mailbox unread badge.

De-registration on `removeMailbox` uses the existing per-mailbox `unregisterDevice`.

**Direct-open already works today.** `App.tsx` `openFromNotification()` already reads the push `data`
and navigates **straight to the message** (`addNotificationResponseReceivedListener` for live/
background taps + `getLastNotificationResponseAsync` for cold start; it even holds a tap that lands
before sign-in and replays it). So a tap NEVER dumps the user on a switcher to pick manually — it
opens the exact email. For multi-mailbox the ONLY addition is: read `data.mailbox` (already in the
payload) and `switchTo()` it before the existing `navigate("Message", …)`. This directly answers the
"will a notification for mailbox B open B, or land me on the switcher?" question: **it opens B.**

## 7. Persistence & security

- Persist the **accounts list** (emails only) in AsyncStorage; the actual tokens stay in
  `cognitoStorage` (already persisted, per-username). No new secret storage.
- On `removeMailbox`: unregister its push token, delete its Cognito session keys, drop it from the
  list, clear its key session if active.
- Encryption is unchanged — each mailbox's key is derived from *its* password at add-time, exactly
  as today; nothing is shared across mailboxes.

## 8. Entitlement

**Unchanged.** Access is gated per **domain** by the Hub's `/api/resolve`; every mailbox added in
v1 is on the same (entitled) domain, so there is no new billing or per-mailbox check. (v2
cross-domain would resolve each domain separately.)

## 9. Phasing

1. **v1a — foundation:** multi-session `AuthContext` (add/switch/remove), account switcher UI
   (Inbox header + Settings), per-mailbox inbox + compose "from". Notifications still single until 1b.
2. **v1b — notifications for all:** per-mailbox push registration + payload routing + per-mailbox
   badges. (Depends on the §6 backend check.)
3. **v2 (later):** cross-domain mailboxes (config per domain); optional unified inbox view.

## 10. Open questions

1. **Switcher placement** — tappable header avatar/name on Inbox that opens a sheet, plus a
   "Mailboxes" section in Settings? (Recommended.)
2. **How many mailboxes** to support in the UI before it needs search — 3–10 typical; design for ~10.
3. **Key caching on switch** — re-derive each switch (simplest) vs cache several unlocked sessions
   (faster, more memory). Start simple.
4. ~~Backend push payload~~ — **RESOLVED:** the payload already includes `data.mailbox` and the
   registry is per-mailbox, so notifications need no backend change (see §6).
