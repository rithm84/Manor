//! Build script for the Manor desktop shell.
//!
//! `tauri_build::build` reads `tauri.conf.json`, generates the capability
//! schemas under `gen/schemas/`, and embeds the platform metadata that
//! `tauri::generate_context!` expands at compile time.

fn main() {
    tauri_build::build()
}
