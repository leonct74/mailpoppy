# Mailpoppy Mobile — agent notes

React Native (Expo SDK 56) **end-user mailbox app** for iOS/Android. Companion to
the desktop admin app (separate repo: `github.com/leonct74/mailpoppy`).

## Mental model: this is the MAILBOX plane only
- It signs in to the deployment's **Cognito User Pool** (SRP) and calls **API
  Gateway** with the resulting JWT. It NEVER uses AWS admin credentials and has no
  provisioning/admin features — those are desktop-only.
- The whole end-user API is 7 endpoints, wrapped by `MailpoppyClient`:
  `GET /messages`, `GET /messages/{id}/raw`, `GET /messages/{id}/attachments/{i}`,
  `PATCH /flags`, `POST /move`, `POST /send`, `GET /usage`.

## Shared code lives in a git submodule — do NOT copy/fork it
- `@mailpoppy/core` (types) and `@mailpoppy/api-client` (the client) come from
  `vendor/mailpoppy` (a submodule of the desktop monorepo). Resolved via
  `metro.config.js` (watchFolders + extraNodeModules) and `tsconfig.json` (paths).
- One source of truth. To update: `cd vendor/mailpoppy && git pull origin main`,
  then commit the bumped submodule pointer. Never duplicate these packages here.

## Verify before committing
- `npx tsc --noEmit` — typecheck (pulls in the imported submodule sources too).
- `npx expo export --platform ios` — proves Metro resolves + bundles everything,
  including the submodule packages and the Cognito polyfill.
- A live login needs a real mailbox + password against the configured deployment.

## Gotchas
- `index.ts` imports `react-native-get-random-values` FIRST — required for the
  Cognito SRP handshake on RN. Don't reorder it below the Cognito import.
- The Cognito SDK needs synchronous storage; `src/cognitoStorage.ts` bridges to
  AsyncStorage and must `hydrate()` once at startup (done in `AuthContext`).
- `src/config.ts` holds PUBLIC deployment IDs (safe to commit); override with
  `EXPO_PUBLIC_*` env vars.

## Release pipeline (iOS) — the human archives in Xcode; Claude does NOT build
The division of labour is fixed:
- **Claude's job ends at code:** update the JS/TS, bump `src/buildInfo.ts` `BUILD_TAG`
  (the JS identifier shown in the Settings footer — this IS Claude's to bump), commit + push.
- **The human then** opens `ios/MailPoppy.xcworkspace` in **Xcode**, bumps the **native build
  number** (Xcode-managed), **archives**, and **distributes**.
- **Do NOT** tell the user to run `npx expo run:ios` / `eas build`, and **do NOT** edit `app.json`
  `buildNumber` — the native build number lives in Xcode (it has already drifted past `app.json`),
  and editing `app.json` can clobber the real number on a `prebuild`. Leave `app.json` alone.
- `store/RUNBOOK.md` describes an EAS flow that is NOT the one in use — this Xcode-archive flow is.

## Git workflow
- Push direct to `main`, no PRs (matches the desktop repo's convention).
- This repo is **private**.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
