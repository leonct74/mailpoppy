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
export const BUILD_TAG = "2026-07-10a";
