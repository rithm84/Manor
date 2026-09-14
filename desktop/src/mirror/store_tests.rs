//! Tests for the mirror store, kept beside it so `store.rs` stays readable.

use super::{Derived, Mirror, MirrorRevision, MirrorRow, MirrorStatus, MIRROR_SCHEMA_VERSION};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::sync::atomic::{AtomicU32, Ordering};

/// The two accounts the tests open files for.
const ACCOUNT: &str = "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa";
const OTHER_ACCOUNT: &str = "8c2e5f31-77b4-42d9-bb60-1a3d9e0c5f22";

/// Keeps each test's file out of every other test's way.
static NEXT: AtomicU32 = AtomicU32::new(0);

/// A directory under the system temporary directory that disappears when
/// the test that made it ends, whether it passed or panicked.
struct TempDirectory(PathBuf);

impl TempDirectory {
    fn create(label: &str) -> Self {
        let unique = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!("manor-mirror-{}-{label}-{unique}", process::id()));
        fs::create_dir_all(&path).expect("the test directory is created");
        Self(path)
    }

    fn file(&self) -> PathBuf {
        self.0.join("mirror.sqlite")
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        // Cleanup only: a leftover temporary directory must not fail a test.
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Opens the file for an account, failing the test when the store refuses.
fn open(directory: &TempDirectory, account_id: &str) -> (Mirror, MirrorStatus) {
    Mirror::open(&directory.file(), account_id).expect("the mirror opens")
}

fn row(key: &str, data: Value, revision: Option<i64>) -> MirrorRow {
    MirrorRow {
        key: key.to_owned(),
        data,
        revision,
    }
}

fn counts(table: &str, count: u64) -> BTreeMap<String, u64> {
    BTreeMap::from([(table.to_owned(), count)])
}

#[test]
fn a_new_file_reports_an_empty_copy() {
    let directory = TempDirectory::create("new");
    let (_mirror, status) = open(&directory, ACCOUNT);
    assert!(!status.ready);
    assert_eq!(status.cursor, 0);
    assert_eq!(status.row_counts, BTreeMap::new());
    assert!(directory.file().exists());
}

#[test]
fn a_replaced_table_reads_back_in_key_order() {
    let directory = TempDirectory::create("replace");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table(
            "tasks",
            &[
                row("b", json!({ "title": "second" }), Some(2)),
                row("a", json!({ "title": "first" }), Some(1)),
            ],
        )
        .expect("the table is replaced");
    mirror
        .replace_table("tasks", &[row("c", json!({ "title": "only" }), None)])
        .expect("the table is replaced again");
    let rows = mirror.rows("tasks").expect("the table reads back");
    assert_eq!(rows, vec![row("c", json!({ "title": "only" }), None)]);
    assert_eq!(
        mirror.status().expect("a status").row_counts,
        counts("tasks", 1)
    );
    assert_eq!(mirror.rows("habits").expect("an empty table"), Vec::new());
}

#[test]
fn an_upserted_row_overwrites_its_data_and_revision() {
    let directory = TempDirectory::create("upsert");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .upsert_rows("tasks", &[row("a", json!({ "title": "before" }), Some(1))])
        .expect("the row is stored");
    mirror
        .upsert_rows(
            "tasks",
            &[
                row("a", json!({ "title": "after" }), Some(4)),
                row("b", json!({ "title": "new" }), None),
            ],
        )
        .expect("the rows are stored");
    assert_eq!(
        mirror.rows("tasks").expect("the rows read back"),
        vec![
            row("a", json!({ "title": "after" }), Some(4)),
            row("b", json!({ "title": "new" }), None),
        ]
    );
}

#[test]
fn deleting_removes_only_the_named_keys() {
    let directory = TempDirectory::create("delete");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table(
            "habit_entries",
            &[
                row("h1\u{1f}2026-09-13", json!({ "done": true }), Some(1)),
                row("h1\u{1f}2026-09-14", json!({ "done": false }), Some(1)),
            ],
        )
        .expect("the table is stored");
    mirror
        .delete_rows(
            "habit_entries",
            &[
                "h1\u{1f}2026-09-13".to_owned(),
                "h1\u{1f}2030-01-01".to_owned(),
            ],
        )
        .expect("the keys are deleted");
    let rows = mirror.rows("habit_entries").expect("the rows read back");
    assert_eq!(
        rows,
        vec![row("h1\u{1f}2026-09-14", json!({ "done": false }), Some(1))]
    );
}

#[test]
fn revisions_read_back_every_key_without_its_row() {
    let directory = TempDirectory::create("revisions");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table(
            "tasks",
            &[
                row("b", json!({ "title": "second" }), Some(2)),
                row("a", json!({ "title": "first" }), None),
            ],
        )
        .expect("the table is stored");
    assert_eq!(
        mirror.revisions("tasks").expect("the revisions read back"),
        vec![
            MirrorRevision {
                key: "a".to_owned(),
                revision: None,
            },
            MirrorRevision {
                key: "b".to_owned(),
                revision: Some(2),
            },
        ]
    );
    assert_eq!(
        mirror.revisions("habits").expect("an empty table"),
        Vec::new()
    );
}

#[test]
fn a_deleted_derived_value_is_gone() {
    let directory = TempDirectory::create("drop-derived");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .put_derived(
            "manor_leetcode_summary",
            &json!({ "solved": 41 }),
            18,
            "2026-09-14",
        )
        .expect("the value is stored");
    mirror
        .delete_derived("manor_leetcode_summary")
        .expect("the value is dropped");
    assert_eq!(
        mirror
            .get_derived("manor_leetcode_summary")
            .expect("a read"),
        None
    );
    // A name the file never held is nothing to drop, because a refresh runs
    // whether or not the value it invalidates was ever computed.
    mirror
        .delete_derived("manor_habits_state")
        .expect("dropping an absent value succeeds");
}

#[test]
fn a_reopened_file_reports_its_cursor_and_rows() {
    let directory = TempDirectory::create("reopen");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table("tasks", &[row("a", json!({ "title": "kept" }), Some(7))])
        .expect("the table is stored");
    mirror
        .commit(4_294_967_296, true)
        .expect("the cursor is recorded");
    drop(mirror);

    let (mirror, status) = open(&directory, ACCOUNT);
    assert!(status.ready);
    assert_eq!(status.cursor, 4_294_967_296);
    assert_eq!(status.row_counts, counts("tasks", 1));
    assert_eq!(status.total_rows(), 1);
    assert_eq!(
        mirror.rows("tasks").expect("the rows read back"),
        vec![row("a", json!({ "title": "kept" }), Some(7))]
    );
}

#[test]
fn another_schema_version_empties_the_copy() {
    let directory = TempDirectory::create("schema");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table("tasks", &[row("a", json!({ "title": "stale" }), Some(1))])
        .expect("the table is stored");
    mirror.commit(12, true).expect("the cursor is recorded");
    mirror
        .put_derived(
            "manor_habits_state",
            &json!({ "streak": 3 }),
            12,
            "2026-09-14",
        )
        .expect("the derived value is stored");
    drop(mirror);

    let connection = Connection::open(directory.file()).expect("the file opens");
    connection
        .execute(
            "update meta set value = ?1 where key = 'schema_version'",
            params![(MIRROR_SCHEMA_VERSION + 1).to_string()],
        )
        .expect("the version is changed");
    connection.close().expect("the file closes");

    let (mirror, status) = open(&directory, ACCOUNT);
    assert!(!status.ready);
    assert_eq!(status.cursor, 0);
    assert_eq!(status.row_counts, BTreeMap::new());
    assert_eq!(
        mirror
            .get_derived("manor_habits_state")
            .expect("a derived read"),
        None
    );
}

#[test]
fn another_account_empties_the_copy() {
    let directory = TempDirectory::create("account");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table("tasks", &[row("a", json!({ "title": "theirs" }), Some(1))])
        .expect("the table is stored");
    mirror.commit(9, true).expect("the cursor is recorded");
    drop(mirror);

    let (_mirror, status) = open(&directory, OTHER_ACCOUNT);
    assert!(!status.ready);
    assert_eq!(status.cursor, 0);
    assert_eq!(status.row_counts, BTreeMap::new());

    let (_mirror, reopened) = open(&directory, ACCOUNT);
    assert_eq!(reopened.row_counts, BTreeMap::new());
}

#[test]
fn a_derived_value_reads_back_with_its_cursor_and_day() {
    let directory = TempDirectory::create("derived");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    assert_eq!(
        mirror
            .get_derived("manor_leetcode_summary")
            .expect("a read"),
        None
    );
    mirror
        .put_derived(
            "manor_leetcode_summary",
            &json!({ "solved": 41 }),
            18,
            "2026-09-14",
        )
        .expect("the value is stored");
    mirror
        .put_derived(
            "manor_leetcode_summary",
            &json!({ "solved": 42 }),
            19,
            "2026-09-15",
        )
        .expect("the value is replaced");
    assert_eq!(
        mirror
            .get_derived("manor_leetcode_summary")
            .expect("a read"),
        Some(Derived {
            value: json!({ "solved": 42 }),
            cursor: 19,
            day: "2026-09-15".to_owned(),
        })
    );
}

#[test]
fn wiping_deletes_the_file() {
    let directory = TempDirectory::create("wipe");
    let (mut mirror, _) = open(&directory, ACCOUNT);
    mirror
        .replace_table("tasks", &[row("a", json!({ "title": "gone" }), Some(1))])
        .expect("the table is stored");
    assert_eq!(mirror.account_id(), ACCOUNT);
    mirror.wipe().expect("the file is deleted");
    assert!(!directory.file().exists());

    let (_mirror, status) = open(&directory, ACCOUNT);
    assert!(!status.ready);
    assert_eq!(status.row_counts, BTreeMap::new());
}
