# Screenshots & store graphics

Reviewers won't approve without screenshots. Capture them from the running app signed in as the
**demo mailbox** (so the inbox has real-looking mail). iPhone-only this release (we set
`supportsTablet: false`), so no iPad set is required.

## What each store needs
**Apple App Store** — one set is enough to start:
- **6.7-inch iPhone**, portrait, **1290 × 2796 px** (e.g. iPhone 15 Pro Max simulator). This slot
  satisfies Apple's required large-iPhone screenshots. 2–10 images.

**Google Play**:
- **Phone screenshots**: 2–8, portrait, 1080 × 1920 px or larger.
- **App icon**: 512 × 512 PNG (have `assets/icon.png` — export at 512).
- **Feature graphic**: **1024 × 500 PNG** (required). Simple crimson-navy banner with the logo +
  "Email on your own domain" — I can design this on request.

## Suggested 5 shots (same flow on both platforms)
1. **Inbox** — the list with a few messages (the hero shot).
2. **Reading a message** — clean reader view.
3. **Compose** — writing a new email (show the dark UI).
4. **Folders / search** — organisation.
5. **Sign-in** — the branded login (shows it's "your domain" email).

Optional captions per shot (App Store lets you overlay text in your own framed images):
"Your inbox, your domain" · "Read & reply on the go" · "Private — your mail stays in your cloud" ·
"Folders & instant search" · "Sign in to your mailbox".

## How to capture
```bash
# iOS (Xcode simulator → iPhone 15 Pro Max), then run the app:
eas build -p ios --profile preview     # or a dev build / Expo Go for screenshots
# In the simulator: Cmd+S saves a 1290×2796 PNG.

# Android (emulator, a 1080×1920+ phone profile): use the emulator camera/screenshot button.
```
Frame/caption them in any tool (Figma, Screenshots.pro, Fastlane frameit) if you want the
polished look — plain in-app captures are also fine to launch with.
