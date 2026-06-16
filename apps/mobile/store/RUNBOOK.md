# MailPoppy mobile — App Store + Google Play runbook

Goal: get **MailPoppy** (iOS + Android) submitted for review. Bundle id `com.mailpoppy.app`,
Expo owner `leonct74`, EAS project already linked.

**Scope of this launch: single-tenant.** The published build points at the current
deployment (the defaults in `src/config.ts` — Cognito `eu-west-1_yV09AF6Ja`, API
`017dtrbes1…eu-west-1`). It serves mailboxes on *that* backend. Email-domain → backend
resolution (so any customer's users can sign in) is the next build and can ship later as an
update — see `store/compliance.md` › "Roadmap note".

Tags: **[you]** = needs your accounts/credentials/decisions · **[done]** = already in the repo ·
**[build]** = Claude-prepared content you paste in.

---

## 0. One-time prerequisites — [you]
- Apple Developer Program — active ✅
- Google Play Developer — active ✅
- Install the CLI and log in to **your** Expo account:
  ```bash
  npm i -g eas-cli
  eas login            # the leonct74 account that owns this project
  eas whoami
  ```

## 1. App config — [done]
- `app.json`: name **"MailPoppy"**, `ios.supportsTablet: false` (iPhone-only first),
  `bundleIdentifier`/`package` = `com.mailpoppy.app`, export-compliance flag set, icons + splash present.
- Camera is **not** used (photo-library only) → no camera permission requested. Good for review.

## 2. Build the production binaries — [you] (Claude can't sign)
EAS manages signing. iOS will prompt you to log in to Apple and will create the distribution
cert + provisioning profile; Android will generate (and store) an upload keystore — let EAS keep it.
```bash
eas build -p ios     --profile production    # → .ipa, uploaded to EAS
eas build -p android --profile production    # → .aab
```
`eas.json` › `production` has `autoIncrement: true` + `appVersionSource: remote`, so build numbers
take care of themselves.

## 3. Create the store records — [you], copy from [build]
**Apple — App Store Connect → Apps → +**
- Platform iOS, name **MailPoppy** (if the name is taken, see `store/listing.md` › fallbacks),
  primary language English, bundle id `com.mailpoppy.app`, SKU `mailpoppy-mobile`.
- Fill the listing from `store/listing.md`, screenshots per `store/screenshots.md`,
  **App Privacy** from `store/compliance.md`, and **App Review Information** (demo login +
  notes) from `store/compliance.md`.

**Google — Play Console → Create app**
- Name **MailPoppy**, app (not game), Free.
- Start on the **Internal testing** track (fastest reviews), then promote to Production.
- Fill the store listing from `store/listing.md`, **Data safety** + **content rating** from
  `store/compliance.md`, upload the `.aab`.

## 4. Submit the builds — [you]
```bash
eas submit -p ios       # uploads to App Store Connect / TestFlight
eas submit -p android   # uploads the .aab to your chosen track
```
`eas submit` will prompt for what it needs. To make it non-interactive later, add to
`eas.json` › `submit.production`:
```jsonc
"ios":     { "appleId": "you@apple.id", "ascAppId": "<App Store Connect app id>", "appleTeamId": "<TEAMID>" },
"android": { "serviceAccountKeyPath": "./play-service-account.json", "track": "internal" }
```
(The ASC app id appears once the Apple app record exists; the Google service-account JSON is
created in Play Console → Setup → API access.)

Then, in each console, **submit for review** (Apple) / **send for review / roll out to Production**
(Google).

## 5. Before you click submit — checklist
- [ ] Demo mailbox created on the live backend; creds in App Store Connect + Play Console (`store/compliance.md`)
- [ ] Privacy Policy URL set: `https://mailpoppy.com/privacy`  ·  Support URL: `https://mailpoppy.com`
- [ ] Screenshots uploaded (`store/screenshots.md`)
- [ ] App Privacy (Apple) + Data safety (Google) completed (`store/compliance.md`)
- [ ] Age rating questionnaire done (expect 4+/Everyone — `store/compliance.md`)

## 6. Not blocking submission, but do soon — [you]
- **Push notifications in production** need an **APNs key** (Apple) and **FCM** (Android) wired to
  `expo-notifications`. Without them the app installs and runs fine, but "new mail" pushes won't fire.
- **Multi-tenant login** (email-domain → backend) so other customers' users can sign in — the next build.
