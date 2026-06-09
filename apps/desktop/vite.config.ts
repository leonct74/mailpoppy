import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Port 1420 + no clearScreen are Tauri conventions, so this drops in cleanly
// once the Tauri shell is added (see README.md).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // amazon-cognito-identity-js (via its bundled `buffer` polyfill) references the
  // Node global `global` — unguarded (`global.TYPED_ARRAY_SUPPORT`). It doesn't
  // exist in the browser/WebView (where the global is `globalThis`/`window`), so a
  // bare `global` throws "Can't find variable: global" and blanks the app. Map it
  // to globalThis in BOTH app code (`define`) and pre-bundled deps
  // (`optimizeDeps.esbuildOptions.define` — Vite does not apply top-level `define`
  // to optimized deps). Node-based tests already have `global`, which is why this
  // only surfaced in the Tauri webview, not in vitest.
  define: { global: "globalThis" },
  optimizeDeps: { esbuildOptions: { define: { global: "globalThis" } } },
  // Bind IPv4 explicitly. Without `host`, Vite may bind localhost as IPv6-only
  // (::1) on macOS; the Tauri WKWebView then resolves localhost → 127.0.0.1,
  // gets connection-refused, and shows a blank window. Pin both ends to IPv4.
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
  },
});
