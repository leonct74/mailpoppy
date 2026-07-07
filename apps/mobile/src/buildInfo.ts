// A human-readable marker of WHICH mobile code is in this build. It lives in the JS
// bundle, so it ALWAYS reflects the code actually running — unlike the native build
// number, which is set by hand in Xcode and can drift out of sync (as it did before).
// Shown in Settings so you can confirm at a glance which build is on the phone.
//
// Bump this string every time the app is handed off for a new TestFlight build.
export const BUILD_TAG = "2026-07-07b · build 24 — attachment self-heal + diagnostics";
