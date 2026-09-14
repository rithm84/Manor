//! The commands the window calls to read and write the mirror.
//!
//! Each one takes the single open mirror and delegates to the store, so nothing
//! here interprets a row. The store work runs on the blocking pool, because
//! SQLite blocks the thread it is on and a bootstrap writes every row of every
//! mirrored table while the window has to keep painting.
//!
//! Every command but the two that ask which mirror is open names the account it
//! means, and a name other than the open mirror's is refused. A pull that was
//! still in flight when the person signed out therefore cannot write into the
//! account that replaced it, and cannot roll its cursor back either. A store
//! failure arrives in the frontend as the store's own message, which names the
//! operation.

use std::fs::{create_dir_all, read_dir, remove_file};
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use log::{info, warn};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::store::{Derived, Mirror, MirrorError, MirrorRevision, MirrorRow, MirrorStatus};
use super::MirrorState;

/// Directory inside the application data directory that holds one file per
/// account.
const MIRROR_DIRECTORY: &str = "mirror";

/// Extension of a mirror file, which its account id names.
const MIRROR_EXTENSION: &str = ".sqlite";

/// Suffixes SQLite appends to a mirror file for its write-ahead companions.
const COMPANION_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

/// Lengths of the five groups of a canonical UUID.
const ACCOUNT_ID_GROUPS: [usize; 5] = [8, 4, 4, 4, 12];

/// Said when the frontend reaches for a mirror it has not opened.
const NOT_OPEN: &str =
    "the mirror is not open; call mirror_open with the signed-in account id first";

/// Said when a panic left the mutex unusable, which only a restart clears.
const LOCK_POISONED: &str =
    "the mirror lock did not survive an earlier failure inside the shell; restart Manor";

/// Opens or creates this account's mirror file and reports where the copy
/// stands. A file left by another account or another schema version is emptied,
/// and the status then says the copy is not ready.
#[tauri::command]
pub async fn mirror_open(
    app: AppHandle,
    state: State<'_, MirrorState>,
    account_id: String,
) -> Result<MirrorStatus, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|cause| {
            format!("the mirror could not find the application data directory: {cause}")
        })?
        .join(MIRROR_DIRECTORY);
    let state = state.inner().clone();
    blocking(move || open_mirror(&state, &directory, &account_id)).await
}

/// Reports readiness, the applied feed cursor, and the row count of each table.
#[tauri::command]
pub async fn mirror_status(state: State<'_, MirrorState>) -> Result<MirrorStatus, String> {
    let state = state.inner().clone();
    blocking(move || {
        let open = lock(&state)?;
        let mirror = open.as_ref().ok_or(NOT_OPEN)?;
        mirror.status().map_err(|cause| cause.to_string())
    })
    .await
}

/// Replaces every row of one table, which is how a bootstrap or a full refresh
/// stores what it read.
#[tauri::command]
pub async fn mirror_replace_table(
    state: State<'_, MirrorState>,
    account_id: String,
    table: String,
    rows: Vec<MirrorRow>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        with_mirror(&state, &account_id, |mirror| {
            mirror.replace_table(&table, &rows)
        })
    })
    .await
}

/// Inserts or overwrites the given rows of one table.
#[tauri::command]
pub async fn mirror_upsert_rows(
    state: State<'_, MirrorState>,
    account_id: String,
    table: String,
    rows: Vec<MirrorRow>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        with_mirror(&state, &account_id, |mirror| {
            mirror.upsert_rows(&table, &rows)
        })
    })
    .await
}

/// Removes the given keys of one table.
#[tauri::command]
pub async fn mirror_delete_rows(
    state: State<'_, MirrorState>,
    account_id: String,
    table: String,
    keys: Vec<String>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        with_mirror(&state, &account_id, |mirror| {
            mirror.delete_rows(&table, &keys)
        })
    })
    .await
}

/// Every row of one table, ordered by key.
#[tauri::command]
pub async fn mirror_rows(
    state: State<'_, MirrorState>,
    account_id: String,
    table: String,
) -> Result<Vec<MirrorRow>, String> {
    let state = state.inner().clone();
    blocking(move || with_mirror(&state, &account_id, |mirror| mirror.rows(&table))).await
}

/// The key and revision of every row of one table, which is what a pull needs
/// to decide which rows are worth re-reading from the server.
#[tauri::command]
pub async fn mirror_revisions(
    state: State<'_, MirrorState>,
    account_id: String,
    table: String,
) -> Result<Vec<MirrorRevision>, String> {
    let state = state.inner().clone();
    blocking(move || with_mirror(&state, &account_id, |mirror| mirror.revisions(&table))).await
}

/// Records how far the change feed has been applied and whether the copy is
/// complete.
#[tauri::command]
pub async fn mirror_commit(
    state: State<'_, MirrorState>,
    account_id: String,
    cursor: u64,
    ready: bool,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || with_mirror(&state, &account_id, |mirror| mirror.commit(cursor, ready))).await
}

/// Caches a derived read against the cursor and account-local day it was
/// computed for.
#[tauri::command]
pub async fn mirror_put_derived(
    state: State<'_, MirrorState>,
    account_id: String,
    name: String,
    value: Value,
    cursor: u64,
    day: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        with_mirror(&state, &account_id, |mirror| {
            mirror.put_derived(&name, &value, cursor, &day)
        })
    })
    .await
}

/// The cached derived read of that name, when the mirror holds one.
#[tauri::command]
pub async fn mirror_get_derived(
    state: State<'_, MirrorState>,
    account_id: String,
    name: String,
) -> Result<Option<Derived>, String> {
    let state = state.inner().clone();
    blocking(move || with_mirror(&state, &account_id, |mirror| mirror.get_derived(&name))).await
}

/// Drops one cached derived read, which is how the frontend invalidates a value
/// fed by a table the change feed does not cover.
#[tauri::command]
pub async fn mirror_delete_derived(
    state: State<'_, MirrorState>,
    account_id: String,
    name: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || with_mirror(&state, &account_id, |mirror| mirror.delete_derived(&name))).await
}

/// Closes the mirror and deletes its file, which is what signing out leaves
/// behind. The mirror leaves the state either way, because a failed delete has
/// still closed the file; the next `mirror_open` starts a fresh copy.
#[tauri::command]
pub async fn mirror_wipe(state: State<'_, MirrorState>, account_id: String) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || wipe(&state, &account_id)).await
}

/// Runs store work on the blocking pool.
///
/// SQLite blocks whichever thread it runs on, and a bootstrap writes tens of
/// thousands of rows, so leaving it on an async worker would stall every other
/// command the window issues while it ran.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|cause| format!("the mirror worker did not finish: {cause}"))?
}

/// Opens this account's file with the state lock held for the whole operation.
///
/// Holding it across the open is what keeps two starts apart: without it both
/// would open a connection and the second store would drop the first, leaving
/// commands writing through a handle nobody else can see.
fn open_mirror(
    state: &MirrorState,
    directory: &Path,
    account_id: &str,
) -> Result<MirrorStatus, String> {
    let account_id = account_uuid(account_id)?;
    let mut open = lock(state)?;
    create_dir_all(directory).map_err(|cause| {
        format!(
            "the mirror could not create the directory {}: {cause}",
            directory.display()
        )
    })?;
    // The previous account's connection closes before the sweep below can reach
    // its file.
    drop(open.take());
    sweep_other_accounts(directory, account_id);
    let file = directory.join(format!("{account_id}{MIRROR_EXTENSION}"));
    let (mirror, status) = Mirror::open(&file, account_id).map_err(|cause| cause.to_string())?;
    *open = Some(mirror);
    info!(
        account = account_id,
        ready = status.ready,
        cursor = status.cursor,
        rows = status.total_rows();
        "mirror opened"
    );
    Ok(status)
}

/// Deletes the mirror files of every other account.
///
/// Signing out removes them, so one that is still here outlived a crash or a
/// delete that failed. It holds the rows of an account nobody on this Mac is
/// signed into, so it goes at the next open rather than waiting for that person
/// to sign in again. Housekeeping only: a sweep that cannot read the directory
/// says so in the log and the open carries on.
fn sweep_other_accounts(directory: &Path, account_id: &str) {
    let entries = match read_dir(directory) {
        Ok(entries) => entries,
        Err(cause) => {
            warn!(
                directory = directory.display().to_string().as_str(),
                cause = cause.to_string().as_str();
                "the mirror could not list its directory to sweep it"
            );
            return;
        }
    };
    // An entry the directory could not describe is left alone; the next open
    // sees it again.
    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !belongs_to_another_account(name, account_id) {
            continue;
        }
        match remove_file(&path) {
            Ok(()) => info!(file = name; "stale mirror removed"),
            Err(cause) => warn!(
                file = name,
                cause = cause.to_string().as_str();
                "the mirror could not remove a stale file"
            ),
        }
    }
}

/// Whether a file in the mirror directory holds another account's copy,
/// counting the write-ahead companions SQLite leaves beside it.
fn belongs_to_another_account(name: &str, account_id: &str) -> bool {
    let stem = COMPANION_SUFFIXES
        .iter()
        .find_map(|suffix| name.strip_suffix(suffix))
        .unwrap_or(name);
    match stem.strip_suffix(MIRROR_EXTENSION) {
        Some(owner) => owner != account_id,
        None => false,
    }
}

/// Closes and deletes the open mirror, after checking it is the one the caller
/// means. A mirror that belongs to somebody else goes back into the state
/// untouched.
fn wipe(state: &MirrorState, account_id: &str) -> Result<(), String> {
    let mut open = lock(state)?;
    let Some(mirror) = open.take() else {
        return Err(NOT_OPEN.to_owned());
    };
    if mirror.account_id() != account_id {
        let refusal = wrong_account(mirror.account_id(), account_id);
        *open = Some(mirror);
        return Err(refusal);
    }
    let wiped = mirror.account_id().to_owned();
    mirror.wipe().map_err(|cause| cause.to_string())?;
    info!(account = wiped.as_str(); "mirror wiped");
    Ok(())
}

/// Takes the mirror lock, which only a panic inside a command can deny.
fn lock(state: &MirrorState) -> Result<MutexGuard<'_, Option<Mirror>>, String> {
    state.0.lock().map_err(|_| LOCK_POISONED.to_owned())
}

/// Runs one operation against the open mirror and phrases its failure for the
/// frontend.
///
/// The account is checked on every call, so work left over from a session that
/// has ended cannot write into the account that replaced it.
fn with_mirror<T>(
    state: &MirrorState,
    account_id: &str,
    operation: impl FnOnce(&mut Mirror) -> Result<T, MirrorError>,
) -> Result<T, String> {
    let mut open = lock(state)?;
    let mirror = open.as_mut().ok_or(NOT_OPEN)?;
    if mirror.account_id() != account_id {
        return Err(wrong_account(mirror.account_id(), account_id));
    }
    operation(mirror).map_err(|cause| cause.to_string())
}

/// Said when a request names an account other than the one the open mirror
/// holds.
fn wrong_account(open: &str, asked: &str) -> String {
    format!(
        "the open mirror holds account {open}, not {asked}; this request belongs to a session that has ended"
    )
}

/// Accepts the canonical lowercase UUID an account id is, and nothing else,
/// because the value names a file on disk.
fn account_uuid(account_id: &str) -> Result<&str, String> {
    let groups: Vec<&str> = account_id.split('-').collect();
    let canonical = groups.len() == ACCOUNT_ID_GROUPS.len()
        && groups.iter().zip(ACCOUNT_ID_GROUPS).all(|(group, length)| {
            group.len() == length
                && group
                    .chars()
                    .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
        });
    if canonical {
        Ok(account_id)
    } else {
        Err(format!(
            "`{account_id}` is not an account id; the mirror takes the signed-in account's UUID"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{account_uuid, belongs_to_another_account};

    const ACCOUNT: &str = "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa";
    const OTHER: &str = "8c2e5f31-77b4-42d9-bb60-1a3d9e0c5f22";

    #[test]
    fn accepts_a_canonical_account_id() {
        assert_eq!(account_uuid(ACCOUNT), Ok(ACCOUNT));
    }

    #[test]
    fn refuses_anything_else() {
        for supplied in [
            "",
            "0f4b1d2a6c384a1e9d772b5c8e4f10aa",
            "0F4B1D2A-6C38-4A1E-9D77-2B5C8E4F10AA",
            "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10a",
            "../../etc/passwd",
            "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10a/",
        ] {
            assert!(account_uuid(supplied).is_err(), "accepted `{supplied}`");
        }
    }

    #[test]
    fn sweeps_the_files_of_other_accounts_and_their_companions() {
        for name in [
            format!("{OTHER}.sqlite"),
            format!("{OTHER}.sqlite-wal"),
            format!("{OTHER}.sqlite-shm"),
        ] {
            assert!(belongs_to_another_account(&name, ACCOUNT), "kept `{name}`");
        }
    }

    #[test]
    fn keeps_this_account_and_anything_that_is_not_a_mirror() {
        for name in [
            format!("{ACCOUNT}.sqlite"),
            format!("{ACCOUNT}.sqlite-wal"),
            format!("{ACCOUNT}.sqlite-shm"),
            "notes.json".to_owned(),
            "sqlite".to_owned(),
        ] {
            assert!(
                !belongs_to_another_account(&name, ACCOUNT),
                "removed `{name}`"
            );
        }
    }
}
