# @mailpoppy/desktop

The desktop app = this **React/Vite frontend** + the **Node provisioning sidecar**
(`./node-sidecar`). Today it runs in the browser via Vite; wrapping it as a native **Tauri v2**
desktop app is a thin next step (Rust toolchain is already present).

## Run (browser, for now)

```bash
npm run dev -w @mailpoppy/desktop-sidecar   # provisioning API on :8787 (set AWS_PROFILE / AWS_REGION)
npm run dev -w @mailpoppy/desktop           # frontend on :1420
```

## Add the Tauri v2 shell (next step)

From `apps/desktop/`:

```bash
npm exec @tauri-apps/cli@latest init        # scaffolds src-tauri/ around this Vite app
# set devUrl http://localhost:1420 and frontendDist ../dist in tauri.conf.json
npm exec @tauri-apps/cli@latest dev
```

The sidecar is bundled as a Tauri **external binary** (sidecar) and spawned on launch; the
frontend talks to it on localhost. The Rust core stays thin — it just spawns the sidecar and
hosts the webview.
