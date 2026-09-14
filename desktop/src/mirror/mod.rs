//! The local mirror the frontend reads its pages from.
//!
//! Manor keeps a SQLite copy of the signed-in account on this Mac so a page
//! renders from local rows and the network only refreshes them. The shell owns
//! the file and nothing else about it: the frontend decides which tables are
//! mirrored, what identifies a row, and when the copy is current, then hands
//! rows here as opaque JSON. No product rule lives in this module.
//!
//! [`store`] is the file itself, plain Rust that the tests exercise without a
//! Tauri runtime; [`commands`] is the thin layer the window calls, which owns
//! the file path, checks that a request names the account the open mirror
//! holds, and turns a store error into the sentence the frontend shows. One
//! account is open at a time, behind a mutex, because one window shows one
//! account.

pub mod commands;
pub mod store;

use std::sync::{Arc, Mutex};

use store::Mirror;

/// The open mirror, or none before the frontend opens one and after it signs
/// out. Held as managed state so every command reaches the same file, and
/// behind an [`Arc`] so a command can carry a handle onto the blocking pool
/// where SQLite runs without occupying an async worker.
#[derive(Default, Clone)]
pub struct MirrorState(pub Arc<Mutex<Option<Mirror>>>);
