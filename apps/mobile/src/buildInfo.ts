// A short code identifying WHICH mobile JS is in this build. It lives in the JS
// bundle, so it ALWAYS reflects the code actually running — unlike the native build
// number, which is set by hand in Xcode and can drift out of sync (as it did before).
// Shown small in the Settings footer. Keep it a bare date+letter code — end users see
// it, so no feature lists or internal jargon; describe the contents HERE instead.
//
// Bump the letter every time the app is handed off for a new TestFlight build.
//
// 2026-07-07d: notification-tap attachments decrypt correctly (resolved enc meta —
//              THE root cause of the poisoned-cache black previews); attachment
//              self-heal + Try again + plain-language errors; per-build attachment
//              cache with startup sweep.
// 2026-07-10a: opening a message no longer fails silently when its domain's backend was
//              rebuilt — the app self-heals the stale config and refetches, and shows a
//              plain-language "domain may not be active" message + Try again instead of a
//              cryptic error.
// 2026-07-10b: the INBOX no longer fails silently when a mailbox's session dies (expired
//              token / rebuilt backend) while push still arrives. It now detects the dead
//              session (even on the background refresh), auto-heals what it can, and — if the
//              token is truly dead — surfaces a "lost its connection" banner with an inline
//              password reconnect, instead of a silent empty inbox needing a remove + re-add.
// 2026-07-14a: a message that fails to decrypt because the mailbox was RE-KEYED (an admin
//              password reset → fresh keypair, while this device kept the old one) now routes
//              to the unlock screen — "this mailbox's key has changed, enter the current
//              password" — instead of dead-ending on "crypto_box_seal_open failed". Mail
//              sealed to a permanently-lost older key gets an honest plain-language message.
export const BUILD_TAG = "2026-07-14a";
