import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Port 1420 + no clearScreen are Tauri conventions, so this drops in cleanly
// once the Tauri shell is added (see README.md).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
