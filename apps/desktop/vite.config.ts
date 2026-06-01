import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1420 + no clearScreen are Tauri conventions, so this drops in cleanly
// once the Tauri shell is added (see README.md).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
