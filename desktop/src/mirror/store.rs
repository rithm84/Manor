//! The mirror store: one SQLite file holding a signed-in account's rows.
//!
//! This is plain Rust with no Tauri types, so the tests below exercise it
//! without a runtime. Three tables carry everything: `meta` holds the schema
//! version, the account the file belongs to, the change-feed cursor the copy is
//! current to, and whether the copy is complete; `rows` holds one record per
//! mirrored row, keyed by the table name and the row's identity; `derived`
//! holds a cached derived read with the cursor and account-local day it was
//! computed for.
//!
//! The store never interprets a row. The frontend decides what a key is and
//! hands over the row's JSON text, and the store returns it unchanged, ordered
//! by key. That keeps every product rule on the frontend side and leaves the
//! shell with storage.
//!
//! The file belongs to exactly one account and one schema version. Opening it
//! for a different account, or after the schema changed, empties it and reports
//! that it is not ready, which asks the caller to bootstrap again. Nothing is
//! migrated, because every row can be pulled from the server again.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a ready mirror file holds: the layout of its tables and the set of
/// account tables the frontend copies into `rows`. Raising it discards every
/// existing file, so the next launch rebuilds the copy from the server. Without
/// the bump, a file built under the previous set stays `ready` while missing the
/// tables that were added, and their reads would come back empty forever.
pub const MIRROR_SCHEMA_VERSION: u32 = 3;

/// Keys of the `meta` table.
const META_SCHEMA_VERSION: &str = "schema_version";
const META_ACCOUNT_ID: &str = "account_id";
const META_CURSOR: &str = "cursor";
const META_READY: &str = "ready";

/// The tables, created on every open so a new file needs no separate step.
const SCHEMA: &str = "
create table if not exists meta(key text primary key, value text not null);
create table if not exists rows(
    table_name text not null,
    key text not null,
    data text not null,
    revision integer,
    primary key(table_name, key)
);
create table if not exists derived(
    name text primary key,
    value text not null,
    cursor integer not null,
    day text not null
);
";

/// One mirrored row: the identity the frontend keys it by, the server's JSON,
/// and the row's revision when its table carries one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MirrorRow {
    pub key: String,
    pub data: Value,
    pub revision: Option<i64>,
}

/// One mirrored row without its JSON: what a pull compares to decide whether
/// re-reading the row from the server would tell it anything it does not hold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MirrorRevision {
    pub key: String,
    pub revision: Option<i64>,
}

/// What the frontend needs to decide between reading the mirror and reading the
/// server: whether the copy is complete, how far the feed it has applied, and
/// how many rows each table holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStatus {
    pub ready: bool,
    pub cursor: u64,
    pub row_counts: BTreeMap<String, u64>,
}

impl MirrorStatus {
    /// Every mirrored row, for the one line the shell logs on open.
    pub fn total_rows(&self) -> u64 {
        self.row_counts.values().sum()
    }
}

/// A cached derived read with the cursor and account-local day that produced
/// it. The caller serves it only while both still match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Derived {
    pub value: Value,
    pub cursor: u64,
    pub day: String,
}

/// Why an operation on the mirror failed. Each message names the operation and
/// carries the cause, because the frontend surfaces it as written.
#[derive(Debug)]
pub enum MirrorError {
    /// SQLite refused a statement. `action` names what the store was doing.
    Database {
        action: String,
        cause: rusqlite::Error,
    },
    /// A file the mirror owns could not be removed.
    File {
        path: PathBuf,
        cause: std::io::Error,
    },
    /// Stored or supplied JSON could not be read or written.
    Json {
        location: String,
        cause: serde_json::Error,
    },
    /// A value the store holds or was handed is outside what it can represent.
    Value { field: String, value: String },
}

impl fmt::Display for MirrorError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database { action, cause } => {
                write!(out, "the mirror could not {action}: {cause}")
            }
            Self::File { path, cause } => write!(
                out,
                "the mirror could not delete {}: {cause}",
                path.display()
            ),
            Self::Json { location, cause } => {
                write!(out, "the mirror could not read {location} as JSON: {cause}")
            }
            Self::Value { field, value } => write!(
                out,
                "the mirror cannot use `{value}` as {field}; sign out and in again to rebuild it"
            ),
        }
    }
}

impl std::error::Error for MirrorError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database { cause, .. } => Some(cause),
            Self::File { cause, .. } => Some(cause),
            Self::Json { cause, .. } => Some(cause),
            Self::Value { .. } => None,
        }
    }
}

/// Names the failed operation in the message the frontend sees.
fn database(action: &str, cause: rusqlite::Error) -> MirrorError {
    MirrorError::Database {
        action: action.to_owned(),
        cause,
    }
}

/// The open mirror file of one account.
pub struct Mirror {
    connection: Connection,
    path: PathBuf,
    account_id: String,
}

impl Mirror {
    /// Opens or creates the file at `path` for `account_id` and reports where
    /// the copy stands.
    ///
    /// A file written by another schema version or another account is emptied
    /// rather than read, so the returned status says the copy is not ready and
    /// the caller bootstraps it.
    pub fn open(path: &Path, account_id: &str) -> Result<(Self, MirrorStatus), MirrorError> {
        let connection =
            Connection::open(path).map_err(|cause| database("open its database file", cause))?;
        // Write-ahead logging lets a read run while a pull writes, and NORMAL
        // gives up only the last commit if the machine loses power, which the
        // next pull fetches again.
        connection
            .query_row("pragma journal_mode = wal", [], |_row| Ok(()))
            .map_err(|cause| database("switch to write-ahead logging", cause))?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|cause| database("relax its durability setting", cause))?;
        connection
            .execute_batch(SCHEMA)
            .map_err(|cause| database("create its tables", cause))?;
        let mut mirror = Self {
            connection,
            path: path.to_owned(),
            account_id: account_id.to_owned(),
        };
        if !mirror.belongs_to_this_build()? {
            mirror.reset()?;
        }
        let status = mirror.status()?;
        Ok((mirror, status))
    }

    /// The account this file holds, for the lines the shell logs.
    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    /// Reports readiness, the applied cursor, and the row count of each table.
    pub fn status(&self) -> Result<MirrorStatus, MirrorError> {
        Ok(MirrorStatus {
            ready: self.flag(META_READY)?,
            cursor: self.number(META_CURSOR)?,
            row_counts: self.row_counts()?,
        })
    }

    /// Replaces every row of one table in a single transaction, which is how a
    /// bootstrap and a full refresh store what they read.
    pub fn replace_table(&mut self, table: &str, rows: &[MirrorRow]) -> Result<(), MirrorError> {
        let transaction = self.begin()?;
        transaction
            .execute("delete from rows where table_name = ?1", params![table])
            .map_err(|cause| database("empty a table", cause))?;
        write_rows(&transaction, table, rows)?;
        transaction
            .commit()
            .map_err(|cause| database("store a table", cause))
    }

    /// Inserts or overwrites the given rows of one table in a single
    /// transaction.
    pub fn upsert_rows(&mut self, table: &str, rows: &[MirrorRow]) -> Result<(), MirrorError> {
        let transaction = self.begin()?;
        write_rows(&transaction, table, rows)?;
        transaction
            .commit()
            .map_err(|cause| database("store rows", cause))
    }

    /// Removes the given keys of one table in a single transaction. A key the
    /// table does not hold changes nothing, because a feed can report a row the
    /// copy never had.
    pub fn delete_rows(&mut self, table: &str, keys: &[String]) -> Result<(), MirrorError> {
        let transaction = self.begin()?;
        {
            let mut statement = transaction
                .prepare("delete from rows where table_name = ?1 and key = ?2")
                .map_err(|cause| database("prepare its delete", cause))?;
            for key in keys {
                statement
                    .execute(params![table, key])
                    .map_err(|cause| database("delete a row", cause))?;
            }
        }
        transaction
            .commit()
            .map_err(|cause| database("delete rows", cause))
    }

    /// Every row of one table, ordered by key.
    pub fn rows(&self, table: &str) -> Result<Vec<MirrorRow>, MirrorError> {
        let mut statement = self
            .connection
            .prepare("select key, data, revision from rows where table_name = ?1 order by key")
            .map_err(|cause| database("prepare its read", cause))?;
        let mut found = statement
            .query(params![table])
            .map_err(|cause| database("read a table", cause))?;
        let mut rows = Vec::new();
        while let Some(row) = found
            .next()
            .map_err(|cause| database("read a table", cause))?
        {
            let key: String = row.get(0).map_err(|cause| database("read a key", cause))?;
            let data: String = row.get(1).map_err(|cause| database("read a row", cause))?;
            let revision: Option<i64> = row
                .get(2)
                .map_err(|cause| database("read a revision", cause))?;
            let data = serde_json::from_str(&data).map_err(|cause| MirrorError::Json {
                location: format!("row `{key}` of {table}"),
                cause,
            })?;
            rows.push(MirrorRow {
                key,
                data,
                revision,
            });
        }
        Ok(rows)
    }

    /// The key and revision of every row of one table, ordered by key.
    ///
    /// A pull reads this rather than [`Self::rows`] because it only compares
    /// revisions, and on a table of any size the JSON it would otherwise carry
    /// across the boundary is nearly all of the bytes.
    pub fn revisions(&self, table: &str) -> Result<Vec<MirrorRevision>, MirrorError> {
        let mut statement = self
            .connection
            .prepare("select key, revision from rows where table_name = ?1 order by key")
            .map_err(|cause| database("prepare its revision read", cause))?;
        let found = statement
            .query_map(params![table], |row| {
                Ok(MirrorRevision {
                    key: row.get(0)?,
                    revision: row.get(1)?,
                })
            })
            .map_err(|cause| database("read revisions", cause))?;
        found
            .collect::<Result<Vec<_>, _>>()
            .map_err(|cause| database("read a revision", cause))
    }

    /// Records how far the feed has been applied and whether the copy is
    /// complete. A pull calls this once, after its rows are stored, so the
    /// cursor never runs ahead of the data.
    pub fn commit(&mut self, cursor: u64, ready: bool) -> Result<(), MirrorError> {
        let transaction = self.begin()?;
        write_meta(&transaction, META_CURSOR, &cursor.to_string())?;
        write_meta(&transaction, META_READY, flag_text(ready))?;
        transaction
            .commit()
            .map_err(|cause| database("record its cursor", cause))
    }

    /// Caches a derived read against the cursor and account-local day it was
    /// computed for.
    pub fn put_derived(
        &mut self,
        name: &str,
        value: &Value,
        cursor: u64,
        day: &str,
    ) -> Result<(), MirrorError> {
        let text = serde_json::to_string(value).map_err(|cause| MirrorError::Json {
            location: format!("the derived value `{name}`"),
            cause,
        })?;
        self.connection
            .execute(
                "insert into derived(name, value, cursor, day)
                 values(?1, ?2, ?3, ?4)
                 on conflict(name) do update set
                     value = excluded.value,
                     cursor = excluded.cursor,
                     day = excluded.day",
                params![name, text, signed("a cursor", cursor)?, day,],
            )
            .map_err(|cause| database("store a derived value", cause))?;
        Ok(())
    }

    /// The cached derived read of that name, when the file holds one.
    pub fn get_derived(&self, name: &str) -> Result<Option<Derived>, MirrorError> {
        let found = self
            .connection
            .query_row(
                "select value, cursor, day from derived where name = ?1",
                params![name],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|cause| database("read a derived value", cause))?;
        let Some((value, cursor, day)) = found else {
            return Ok(None);
        };
        Ok(Some(Derived {
            value: serde_json::from_str(&value).map_err(|cause| MirrorError::Json {
                location: format!("the derived value `{name}`"),
                cause,
            })?,
            cursor: unsigned("a stored cursor", cursor)?,
            day,
        }))
    }

    /// Drops one cached derived read, which a table without a change-feed
    /// trigger needs: a refresh of such a table does not move the cursor the
    /// value was cached under, so nothing else would invalidate it.
    pub fn delete_derived(&mut self, name: &str) -> Result<(), MirrorError> {
        self.connection
            .execute("delete from derived where name = ?1", params![name])
            .map_err(|cause| database("delete a derived value", cause))?;
        Ok(())
    }

    /// Closes the file and deletes it with its write-ahead companions, which is
    /// what signing out leaves behind.
    pub fn wipe(self) -> Result<(), MirrorError> {
        let Self {
            connection, path, ..
        } = self;
        connection
            .close()
            .map_err(|(_, cause)| database("close its database file", cause))?;
        for suffix in ["", "-wal", "-shm"] {
            let mut companion = path.clone().into_os_string();
            companion.push(suffix);
            remove(&PathBuf::from(companion))?;
        }
        Ok(())
    }

    /// Whether the file already belongs to this account and schema version.
    fn belongs_to_this_build(&self) -> Result<bool, MirrorError> {
        let version = self.stored(META_SCHEMA_VERSION)?;
        let account = self.stored(META_ACCOUNT_ID)?;
        Ok(
            version.as_deref() == Some(MIRROR_SCHEMA_VERSION.to_string().as_str())
                && account.as_deref() == Some(self.account_id.as_str()),
        )
    }

    /// Empties every table and writes the identity of an empty copy.
    fn reset(&mut self) -> Result<(), MirrorError> {
        let account_id = self.account_id.clone();
        let transaction = self.begin()?;
        for table in ["rows", "derived", "meta"] {
            transaction
                .execute(&format!("delete from {table}"), [])
                .map_err(|cause| database("empty its tables", cause))?;
        }
        write_meta(
            &transaction,
            META_SCHEMA_VERSION,
            &MIRROR_SCHEMA_VERSION.to_string(),
        )?;
        write_meta(&transaction, META_ACCOUNT_ID, &account_id)?;
        write_meta(&transaction, META_CURSOR, "0")?;
        write_meta(&transaction, META_READY, flag_text(false))?;
        transaction
            .commit()
            .map_err(|cause| database("start a fresh copy", cause))
    }

    /// Starts a transaction, which every multi-row operation runs inside.
    fn begin(&mut self) -> Result<Transaction<'_>, MirrorError> {
        self.connection
            .transaction()
            .map_err(|cause| database("start a transaction", cause))
    }

    /// The value of one `meta` key, when the file holds it.
    fn stored(&self, key: &str) -> Result<Option<String>, MirrorError> {
        self.connection
            .query_row(
                "select value from meta where key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|cause| database("read its metadata", cause))
    }

    /// A `meta` flag. A key the file does not hold reads as false, which is the
    /// state of a copy that has never been written.
    fn flag(&self, key: &str) -> Result<bool, MirrorError> {
        match self.stored(key)?.as_deref() {
            None | Some("false") => Ok(false),
            Some("true") => Ok(true),
            Some(other) => Err(MirrorError::Value {
                field: format!("the `{key}` flag"),
                value: other.to_owned(),
            }),
        }
    }

    /// A `meta` number. A key the file does not hold reads as zero.
    fn number(&self, key: &str) -> Result<u64, MirrorError> {
        match self.stored(key)? {
            None => Ok(0),
            Some(text) => text.parse().map_err(|_| MirrorError::Value {
                field: format!("the `{key}` number"),
                value: text,
            }),
        }
    }

    /// How many rows each mirrored table holds.
    fn row_counts(&self) -> Result<BTreeMap<String, u64>, MirrorError> {
        let mut statement = self
            .connection
            .prepare(
                "select table_name, count(*) from rows group by table_name order by table_name",
            )
            .map_err(|cause| database("prepare its row count", cause))?;
        let mut found = statement
            .query([])
            .map_err(|cause| database("count its rows", cause))?;
        let mut counts = BTreeMap::new();
        while let Some(row) = found
            .next()
            .map_err(|cause| database("count its rows", cause))?
        {
            let table: String = row
                .get(0)
                .map_err(|cause| database("read a table name", cause))?;
            let count: i64 = row
                .get(1)
                .map_err(|cause| database("read a row count", cause))?;
            counts.insert(table, unsigned("a row count", count)?);
        }
        Ok(counts)
    }
}

/// Inserts or overwrites rows through one prepared statement.
fn write_rows(
    transaction: &Transaction<'_>,
    table: &str,
    rows: &[MirrorRow],
) -> Result<(), MirrorError> {
    let mut statement = transaction
        .prepare(
            "insert into rows(table_name, key, data, revision) values(?1, ?2, ?3, ?4)
             on conflict(table_name, key) do update set
                 data = excluded.data,
                 revision = excluded.revision",
        )
        .map_err(|cause| database("prepare its write", cause))?;
    for row in rows {
        let data = serde_json::to_string(&row.data).map_err(|cause| MirrorError::Json {
            location: format!("row `{}` of {table}", row.key),
            cause,
        })?;
        statement
            .execute(params![table, row.key, data, row.revision])
            .map_err(|cause| database("write a row", cause))?;
    }
    Ok(())
}

/// Writes one `meta` key.
fn write_meta(transaction: &Transaction<'_>, key: &str, value: &str) -> Result<(), MirrorError> {
    transaction
        .execute(
            "insert into meta(key, value) values(?1, ?2)
             on conflict(key) do update set value = excluded.value",
            params![key, value],
        )
        .map_err(|cause| database("write its metadata", cause))?;
    Ok(())
}

/// How a flag is spelled in `meta`.
fn flag_text(flag: bool) -> &'static str {
    if flag {
        "true"
    } else {
        "false"
    }
}

/// Deletes a file the mirror owns, treating one that is already gone as done,
/// which is what a checkpointed write-ahead companion looks like.
fn remove(path: &Path) -> Result<(), MirrorError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(cause) if cause.kind() == ErrorKind::NotFound => Ok(()),
        Err(cause) => Err(MirrorError::File {
            path: path.to_owned(),
            cause,
        }),
    }
}

/// Converts a SQLite integer to the unsigned number the interface reports.
fn unsigned(field: &str, number: i64) -> Result<u64, MirrorError> {
    u64::try_from(number).map_err(|_| MirrorError::Value {
        field: field.to_owned(),
        value: number.to_string(),
    })
}

/// Converts a supplied number to the signed integer SQLite stores.
fn signed(field: &str, number: u64) -> Result<i64, MirrorError> {
    i64::try_from(number).map_err(|_| MirrorError::Value {
        field: field.to_owned(),
        value: number.to_string(),
    })
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
