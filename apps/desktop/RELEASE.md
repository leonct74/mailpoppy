# Releasing the MailPoppy desktop poppy (→ GitHub → AgentsPoppy)

The runbook for shipping a new **desktop** version. This is the step that was previously
undocumented — the README stops at `npm run tauri:build` (the local `.app`/`.dmg`); this file
covers **packaging + publishing** so an update actually reaches users.

> Mobile releases live in [`store/RUNBOOK.md`](../mobile/store/RUNBOOK.md).
> The *audit/verify* side (how a user reproduces + checks an update before applying) is
> [`node-sidecar/REPRODUCE.md`](node-sidecar/REPRODUCE.md). The canonical platform design is
> `VERIFIABLE_UPDATES.md` in the **separate AgentsPoppy repo** (not in this repo).

## How an update reaches a user (the mental model)

```
bump version → tauri:build (.app) → package as com.mailpoppy.desktop-<v>-darwin-arm64.zip
   → git commit + tag v<v> + push → gh release create (attach the zip)
   → ⚠ UPDATE THE CATALOG: bump the com.mailpoppy.desktop entry in
     agentspoppy-web/public/directory/catalog.json (version + package url + sha256) → push
     → Firebase App Hosting redeploys agentspoppy-web
   → AgentsPoppy polls the CATALOG (~60s) → detects the new version → user AUDITS it
     (the built-in "Verify with your AI agent" / REPRODUCE.md flow) → installs from AgentsPoppy
```

MailPoppy (the desktop app) is a **poppy** installed/updated through **AgentsPoppy**. AgentsPoppy
does **NOT** watch GitHub releases directly — it polls a **remote catalog**,
`agentspoppy-web/public/directory/catalog.json`, served at
`https://agentspoppy-web--agentspoppy.europe-west4.hosted.app/directory/catalog.json`
(the `DEFAULT_CATALOG_URL` in the AgentsPoppy broker). That catalog pins each poppy's current
`version` + package `url` + `sha256`; AgentsPoppy compares it to the installed version to compute
`updateAvailable`. **The GitHub release only *hosts the zip the catalog points at*.**

So "shipping a desktop change" = **publish the GitHub release (step 5) AND bump the catalog entry
(step 7)**. Skipping the catalog step means the update is invisible in AgentsPoppy no matter how
many releases you cut — this is the exact bug that bit us on v0.1.4. Users never download the `.app`
by hand; they audit and install inside AgentsPoppy.

## Prerequisites

- macOS on **Apple Silicon** (the release target is `darwin-arm64` / `aarch64-apple-darwin`).
- **Rust/cargo** + **tauri-cli** (`npx tauri --version`).
- Push access to `github.com/leonct74/mailpoppy` (HTTPS credential in the keychain is enough).
- For the release step: **`gh` authenticated** (`gh auth status`) **or** a `GH_TOKEN`. If `gh` isn't
  logged in but `git push` works, you can reuse the stored credential — see the gotcha below.

## Steps

### 1. Bump the version — in THREE files, and they MUST match
`extensionManifest.ts` literally comments "must match src-tauri/tauri.conf.json". Bump all three:

- `apps/desktop/src-tauri/tauri.conf.json` → `"version"`
- `apps/desktop/extension.json` → `"version"`
- `apps/desktop/node-sidecar/src/extensionManifest.ts` → `const VERSION`

(Patch bumps for fixes: `0.1.3 → 0.1.4`. The bundle version is read from `tauri.conf.json`; the
Rust crate's own `Cargo.toml` version is unrelated and stays as-is.)

### 2. Build the app
```bash
cd apps/desktop
npm run tauri:build      # beforeBuildCommand rebuilds the sidecar + frontend, then bundles
```
Produces, under `src-tauri/target/release/bundle/`:
- `macos/Mailpoppy.app`
- `dmg/Mailpoppy_<v>_aarch64.dmg`

Sanity: `du -sh macos/Mailpoppy.app` (~130 MB — the embedded sidecar is ~123 MB) and
`/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" macos/Mailpoppy.app/Contents/Info.plist`
should print the new version.

### 3. Package the `.app` as the AgentsPoppy release asset
The asset name is load-bearing — AgentsPoppy downloads `com.mailpoppy.desktop-<v>-darwin-arm64.zip`.
Use **`ditto`**, not `zip` (ditto preserves the `.app`'s macOS metadata + ad-hoc code signature;
plain `zip` can corrupt the bundle):
```bash
cd src-tauri/target/release/bundle
ditto -c -k --keepParent macos/Mailpoppy.app com.mailpoppy.desktop-<v>-darwin-arm64.zip
shasum -a 256 com.mailpoppy.desktop-<v>-darwin-arm64.zip   # note this — it goes in the notes
```

### 4. Commit, tag, push
The release tag must point at the committed source so the audit's compare link works.
```bash
cd <repo root>
git add -A
git commit -m "release: v<v> — <summary>"   # end with the Co-Authored-By trailer
git push origin main                          # this repo ships from main (no PRs)
git tag v<v>
git push origin v<v>
```

### 5. Create the GitHub release with the asset
```bash
gh release create v<v> \
  apps/desktop/src-tauri/target/release/bundle/com.mailpoppy.desktop-<v>-darwin-arm64.zip \
  --repo leonct74/mailpoppy \
  --title "MailPoppy v<v>" \
  --notes "<what changed>

Audit: https://github.com/leonct74/mailpoppy/compare/v<prev>...v<v>
Package sha256: <sha from step 3>"
```

### 6. Verify it published
```bash
curl -sS -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/leonct74/mailpoppy/releases/tags/v<v> \
  | grep -Ei '"tag_name"|"name"|"size"|"browser_download_url"'
```
Confirm the asset is attached and its size looks right. **This does NOT yet make AgentsPoppy show
the update — do step 7.**

### 7. Update the AgentsPoppy catalog (the step that actually surfaces the update)
Edit `agentspoppy-web/public/directory/catalog.json` → the `com.mailpoppy.desktop` entry:
- `version` → `<v>`
- `packages.darwin-arm64.url` → the v`<v>` release download URL
- `packages.darwin-arm64.sha256` → the sha256 from **step 3**
- top-level `updatedAt` → today

Then push — `agentspoppy-web` is on **Firebase App Hosting**, so a push to `main` auto-redeploys:
```bash
cd ../agentspoppy-web    # separate repo: github.com/leonct74/agentspoppy-web
# validate before committing (same rules as src/lib/listingRules.ts):
node -e "const p=require('./public/directory/catalog.json').poppies.find(x=>x.id==='com.mailpoppy.desktop'); const s=p.packages['darwin-arm64'].sha256; if(!/^[0-9a-f]{64}$/i.test(s))throw 'bad sha'; console.log('ok', p.version)"
git add public/directory/catalog.json
git commit -m "catalog: MailPoppy <prev> → <v>"
git push origin main
```
Wait ~1–2 min for App Hosting to rebuild, then confirm the **live** catalog serves the new version:
```bash
curl -s https://agentspoppy-web--agentspoppy.europe-west4.hosted.app/directory/catalog.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).poppies.find(p=>p.id==='com.mailpoppy.desktop').version))"
```
AgentsPoppy re-polls the catalog roughly every 60s, so the update appears shortly after — the user
audits it (backend code is reproducibly verifiable per REPRODUCE.md; the host binary is a separate
trust root) and installs.

## Gotchas (each of these has bitten us)

- **All three version files must match.** A mismatch means AgentsPoppy and the sidecar disagree
  about what version is running.
- **`ditto`, never `zip`.** Plain `zip` mangles the `.app` bundle (signature/symlinks) → won't launch.
- **Ad-hoc signing only.** `codesign -dv` shows `Signature=adhoc`, `TeamIdentifier=not set`.
  Notarization is Phase 5, so Gatekeeper will warn on a manual open — AgentsPoppy handles the
  install path. This is consistent across all releases so far; don't "fix" it ad hoc.
- **Stale prebuilt sidecar / backend bundle.** `tauri:build` runs `build:sidecar`, which regenerates
  the embedded CFN template + Lambda zip. If you changed `lambdas/`, `infra/`, or core code a Lambda
  imports, that regeneration is what carries the fix — see the [CLAUDE.md](../../CLAUDE.md) 🪤 note.
- **`gh` not logged in?** `git push` uses the keychain credential; you can reuse it for the release
  without `gh auth login`:
  ```bash
  TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | sed -n 's/^password=//p')
  GH_TOKEN="$TOKEN" gh release create ...
  ```
- **Version must be higher than the installed one** or AgentsPoppy won't surface it as an update.
- **The catalog — not the GitHub release — is what AgentsPoppy reads.** A perfect release with no
  catalog bump is invisible. `updateAvailable` = (catalog `version` > installed `version`). Always
  do step 7. (This is the v0.1.4 miss: release cut, catalog untouched, "AgentsPoppy doesn't see it".)

## Worked example — v0.1.4 (2026-07-10)

The three-file bump `0.1.3 → 0.1.4`, `npm run tauri:build`, `ditto` →
`com.mailpoppy.desktop-0.1.4-darwin-arm64.zip` (44.87 MB, sha256
`e95f9462f65d0802c9fe4775e95df9e68d4512d30d6c7b1e51ab3f568a154d6f`), commit `895d5b0`, tag `v0.1.4`,
release <https://github.com/leonct74/mailpoppy/releases/tag/v0.1.4>. **Step 7 (initially missed):**
`agentspoppy-web` catalog bumped in commit `f70d9df` — that's what made AgentsPoppy finally show it.

## Related pipelines (not this file)

- **Mobile app** → [`apps/mobile/store/RUNBOOK.md`](../mobile/store/RUNBOOK.md) (EAS / Xcode; bump
  `buildInfo.ts` `BUILD_TAG` + `app.json` `buildNumber`).
- **Backend Lambda code** (deployed into the *user's* AWS, not shipped in the app) → updated in-app
  via the "Update backend" flow (`views/BackendUpdate.tsx`), audited via
  [`node-sidecar/REPRODUCE.md`](node-sidecar/REPRODUCE.md).
