//! Entry point of the Manor desktop binary.
//!
//! The shell itself lives in the `manor_desktop_lib` library so the same code
//! backs every Tauri target; this binary only starts it.

// A release build must not open a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    manor_desktop_lib::run()
}
