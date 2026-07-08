# Repo split — staged locally (2026-06-14)

Phase-1 "repo split" task, done as **local staging only**. Nothing is on GitHub; the
existing `leonct74/mailpoppy` monorepo is **untouched** and retains full history (it's the
archive). Two new local repos were produced and verified.

## What exists now

| Local path | Repo | Visibility (intended) | History |
|---|---|---|---|
| `~/Projects/mailpoppy` | original monorepo | private (unchanged) | full — keep as archive |
| `~/Projects/mailpoppy-engine` | **open engine** | → public (Phase 2, yours) | fresh, 1 commit (squashed — no leaked account-id/test-domain history) |
| `~/Projects/mailpoppy-app` | **closed admin app** | private | fresh, 1 commit |

## The cut line (verified against the build graph)

- **engine** = `packages/*` + `lambdas/` + `infra/` (incl. `infra/policies/`) + `node-sidecar/`.
  Self-contained: `node-sidecar`'s `gen:backend` esbuilds the lambdas and `cdk synth`s the
  infra template (all in-repo). Depends only on `@mailpoppy/core` (in-repo).
- **app** = the Tauri/React UI (`src/`, `src-tauri/`, `index.html`, `vite`, `tsconfig`) +
  `stitch/` (local design refs, gitignored). Needs from the engine only: `@mailpoppy/core` +
  `@mailpoppy/api-client` (build-time imports) and the **compiled sidecar binary**.

## Consumption model: git submodule

The app embeds the engine at `engine/` as a **git submodule** and references it via npm
workspaces (`engine/packages/*`, `engine/node-sidecar`, `engine/lambdas`, `engine/infra`).
`build:sidecar` runs the submodule's builder with `MAILPOPPY_SIDECAR_OUT=src-tauri/binaries`.

## Edits made during the split (in the engine copy only; monorepo untouched)

1. `node-sidecar/` promoted to the engine repo root (was `apps/desktop/node-sidecar`).
2. `node-sidecar/scripts/build-backend-bundle.mjs`: `repoRoot` `../../..` → `..`.
3. `node-sidecar/scripts/build-sidecar.mjs`: binary output dir now honours
   `MAILPOPPY_SIDECAR_OUT` (default unchanged, so it's backward-compatible).
4. `node-sidecar/tsconfig.json`: `extends` `../../../tsconfig.base.json` → `../tsconfig.base.json`.
5. App `tsconfig.json`: `extends` `../../tsconfig.base.json` → `./tsconfig.base.json`
   (a copy of `tsconfig.base.json` lives in the app root).
6. App `package.json`: added `workspaces` (into `engine/`), repointed `build:sidecar`.
7. Governance/licence files copied into the engine root (drafting-comment headers stripped);
   README/SECURITY path refs updated to `node-sidecar/`.

## Verification (all green)

- **engine**: `npm run typecheck` exit 0 · `npm test` 165 passed · `npm run gen:backend` OK
  (esbuild + cdk synth) · `npm run build:sidecar` → 119 MB Mach-O arm64 SEA binary.
- **app**: `npm run build` (tsc --noEmit + vite build) OK · `npm test` 310 passed ·
  `npm run build:sidecar` (via submodule) → binary written to the app's `src-tauri/binaries/`.
- Not run here (needs Rust toolchain + signing certs): the full `tauri build`. Its inputs
  (the sidecar `externalBin` + the vite `dist`) both build, so it has what it needs.

## Pushed to GitHub — 2026-06-14 (both PRIVATE)

1. ✅ **Repos created** (by you) and pushed:
   - `https://github.com/leonct74/mailpoppy-engine` — **private**, `main` @ `2115571`.
   - `https://github.com/leonct74/mailpoppy-app` — **private**, `main` (initial + submodule-URL commit).
2. ✅ **Submodule URL repointed** to the engine's GitHub HTTPS URL (`.gitmodules` + `git submodule sync`), committed.
3. ✅ **Verified:** unauthenticated API returns 404 for both (private); a fresh
   `git clone --recurse-submodules` of the app populates `engine/` from GitHub and resolves the gitlink.

## Remaining — gated to you (irreversible)

- **Phase 2 (yours only):** flip **`mailpoppy-engine`** to **public** after the `security@mailpoppy.com`
  alias exists. The app repo stays private. Changing visibility is an access-control change — I won't do it.
- Before that flip: the engine's history is a single squashed commit (clean), so it's publish-safe.

> Reminder: clone the app with `--recurse-submodules` (or `git submodule update --init`),
> or `engine/` is empty and `npm install` fails.
