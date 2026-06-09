import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// The Tauri window launches hidden (`"visible": false`) so users never see the
// blank-webview flash on a cold start. Reveal it only once React has painted its
// first frame — a double requestAnimationFrame waits for layout + paint to
// commit. Outside Tauri (tests / plain browser) there's no window to show, so
// this is a no-op. If the hand-off ever fails, the Rust setup hook reveals the
// window after a short fallback delay, so the app can't get stuck invisible.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  requestAnimationFrame(() =>
    requestAnimationFrame(async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().show();
      } catch {
        /* Rust safety-net will reveal the window. */
      }
    }),
  );
}
