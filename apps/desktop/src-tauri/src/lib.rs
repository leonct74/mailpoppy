//! Mailpoppy desktop shell.
//!
//! The Rust core stays deliberately thin: it hosts the webview (the React app)
//! and spawns the **provisioning sidecar** (a self-contained Node binary shipped
//! as a Tauri `externalBin`) on launch, then tears it down on exit. The frontend
//! talks to the sidecar over `http://127.0.0.1:8787` — no AWS credentials ever
//! cross into the webview.

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// Holds the running sidecar child so we can kill it when the app exits.
#[derive(Default)]
struct SidecarState(Mutex<Option<CommandChild>>);

/// AWS env vars worth forwarding to the sidecar. (When launched from Finder a
/// GUI app inherits no shell env, so the SDK falls back to the default profile
/// + `~/.aws/config`; forwarding these helps when launched from a terminal.)
const FORWARDED_ENV: [&str; 5] = [
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
];

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = app.shell().sidecar("mailpoppy-sidecar")?.env("PORT", "8787");
    for key in FORWARDED_ENV {
        if let Ok(val) = std::env::var(key) {
            cmd = cmd.env(key, val);
        }
    }

    let (mut rx, child) = cmd.spawn()?;
    app.state::<SidecarState>()
        .0
        .lock()
        .expect("sidecar mutex poisoned")
        .replace(child);

    // Drain the sidecar's output into the app's stdout/stderr for debugging.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => print!("[sidecar] {}", String::from_utf8_lossy(&bytes)),
                CommandEvent::Stderr(bytes) => eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes)),
                CommandEvent::Error(err) => eprintln!("[sidecar] error: {err}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] terminated: {payload:?}");
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Some(child) = state.0.lock().expect("sidecar mutex poisoned").take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Opens attachment download URLs (presigned S3) in the system browser —
        // window.open() does nothing in the WKWebView.
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState::default())
        .setup(|app| {
            spawn_sidecar(app.handle())?;

            // The main window starts hidden (`"visible": false`) so users never
            // see the blank webview flash on launch — the frontend calls
            // `getCurrentWindow().show()` once React has painted its first frame.
            // This is a safety net: if the frontend ever fails to do so (a JS
            // error, a missing permission), reveal the window anyway after a
            // short delay so the app can never get stuck invisible.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mailpoppy")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                kill_sidecar(app_handle);
            }
        });
}
