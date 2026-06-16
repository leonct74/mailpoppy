# Mailpoppy Mobile

The **end-user mailbox app** for Mailpoppy, for iOS and Android — built with
React Native (Expo). It lets a mailbox owner sign in and read & send mail. It is
deliberately separate from the desktop admin app: this app never touches AWS
credentials or provisioning. It only ever talks to the deployment's Cognito User
Pool (to sign in) and its API Gateway (to read/send mail), authenticated with a
short-lived JWT.

## Architecture

```
mailpoppy-mobile/
├─ App.tsx              Navigation + auth gate
├─ index.ts            Entry (loads the RN crypto polyfill first)
├─ src/
│  ├─ config.ts        Which deployment to connect to (public IDs; EXPO_PUBLIC_* overridable)
│  ├─ auth.ts          Cognito SRP sign-in (mirrors the desktop CognitoAuth)
│  ├─ cognitoStorage.ts Sync storage bridge (AsyncStorage-backed) for the Cognito SDK
│  ├─ mailClient.ts    The shared MailpoppyClient, wired to this app's config + session
│  ├─ eml.ts           Parse raw .eml for the reader (postal-mime)
│  ├─ AuthContext.tsx  Session state/provider
│  └─ screens/         Login · Inbox · Message · Compose
└─ vendor/mailpoppy/   ← git submodule of the desktop monorepo (shared code)
```

### Shared code (git submodule)

`@mailpoppy/core` (types) and `@mailpoppy/api-client` (the API-Gateway client) are
**not duplicated** here — they live in the desktop monorepo and are pulled in as a
git submodule at `vendor/mailpoppy`. Metro and TypeScript are configured to resolve
the `@mailpoppy/*` imports from there (see `metro.config.js` and `tsconfig.json`).
This keeps the mobile client's API surface in lockstep with the backend contract —
one source of truth, no drift.

After cloning:

```bash
git clone <this repo>
cd mailpoppy-mobile
git submodule update --init    # fetch vendor/mailpoppy
npm install
```

To pick up backend changes, bump the submodule:

```bash
cd vendor/mailpoppy && git pull origin main && cd ../..
git add vendor/mailpoppy && git commit -m "Bump shared packages"
```

## Run

```bash
npm install
npm run ios       # iOS simulator (needs Xcode)
npm run android   # Android emulator
npm start         # dev server; scan the QR with Expo Go
```

## Configuration

`src/config.ts` ships the current deployment's **public** identifiers (Cognito User
Pool ID, App Client ID, API Gateway URL — none are secret). Point the app at a
different backend without editing code via env vars at build time:

```bash
EXPO_PUBLIC_AWS_REGION=eu-west-1 \
EXPO_PUBLIC_USER_POOL_ID=... \
EXPO_PUBLIC_CLIENT_ID=... \
EXPO_PUBLIC_API_BASE_URL=https://....execute-api.eu-west-1.amazonaws.com \
npm start
```

## Verify

```bash
npx tsc --noEmit          # typecheck (incl. the shared packages it imports)
npx expo export --platform ios   # prove Metro bundles everything (incl. the submodule)
```
