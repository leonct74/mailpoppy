# @mailpoppy/desktop

The desktop app = a **React/Vite frontend** + a **Node provisioning sidecar** (`./node-sidecar`),
wrapped in a native **Tauri v2** shell (`./src-tauri`). The Rust core stays thin: it hosts the
webview and spawns/kills the sidecar. The frontend talks to the sidecar on `http://127.0.0.1:8787`;
AWS credentials never enter the webview.

## Run in the browser (fastest dev loop)

```bash
npm run dev -w @mailpoppy/desktop-sidecar   # provisioning API on :8787 (set AWS_PROFILE / AWS_REGION)
npm run dev -w @mailpoppy/desktop           # frontend on :1420
```

## Run as the native app (Tauri dev)

```bash
# from apps/desktop/ — builds the sidecar binary first, then launches the Tauri window
npm run tauri:dev
```

`beforeDevCommand` runs `npm run build:sidecar` (compiles the sidecar into a standalone binary)
then `npm run dev` (Vite). The Rust shell spawns the sidecar on launch and kills it on exit.

## Package a distributable

```bash
# from apps/desktop/ — produces a .app and .dmg under src-tauri/target/release/bundle/
npm run tauri:build
```

`beforeBuildCommand` rebuilds the sidecar binary and the frontend, then Tauri bundles everything.

## The sidecar binary

`npm run build:sidecar` (→ `node-sidecar/scripts/build-sidecar.mjs`) compiles the Node sidecar into
a **single self-contained executable** so end users never need Node installed:

1. **esbuild** bundles `node-sidecar/src/index.ts` (+ `@mailpoppy/core`, fastify, AWS SDK v3) into
   one CJS file.
2. **Node 22 SEA** (Single Executable Application) injects that bundle into a copy of the Node
   runtime. On macOS the system Node is often a *universal* binary, so the script thins it to the
   target arch with `lipo` first (otherwise the SEA fuse sentinel appears twice), then re-signs
   ad-hoc with `codesign`.

The output lands at `src-tauri/binaries/mailpoppy-sidecar-<target-triple>` — the name Tauri's
`externalBin` resolver expects. The binary is git-ignored (a per-platform build artifact);
`build:sidecar` regenerates it.

## Layout

| Path | What |
|---|---|
| `src/` | React frontend (views, lib, MailClient) |
| `node-sidecar/` | Node provisioning sidecar (Fastify + AWS SDK v3) |
| `src-tauri/` | Tauri v2 Rust shell (`src/lib.rs` spawns the sidecar), `tauri.conf.json`, icons |
| `src-tauri/binaries/` | generated sidecar executable (git-ignored) |
