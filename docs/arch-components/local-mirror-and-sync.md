# Local mirror and sync

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

The app reads from a copy of the account kept in SQLite on the Mac, so a page renders from disk and the network only refreshes it. The mirror is a copy, not the record: nothing is written into it except what the server returns, and every write still goes through [`manor_command`](gateway-and-commands.md).

## Storage

`MirrorStore` opens one GRDB database per account at `~/Library/Application Support/<bundle id>/mirror/<account id>.sqlite`, in WAL mode, so reads see the last committed state while a pull writes. Opening a store sweeps files that belong to other accounts. A schema version (currently 6) rebuilds the copy whenever the set of mirrored tables or their shape changes. If the file can't be opened, the gateway reads the server one request at a time; the app still works, only slower.

The mirror holds full rows, including `revision`, for these tables:

- **Tasks and Home:** `profiles`, `contexts`, `tasks`, `scratch_blocks`, `saved_task_views`, `calendar_accounts`, `calendars`, `calendar_events`.
- **Tracking and Pomodoro:** `habits`, `habit_entries`, `mood_focus_entries`, `pomodoro_sessions`, plus the cached derived habits state.
- **Notes:** `note_folders`, `note_pages` with their document content, `note_suggestions`.
- **Problems:** `leetcode_problems` and `problem_content_versions` (custom problems only), `leetcode_attempts`, `leetcode_notes`, `saved_problem_views`, `problem_practice`, and the shared catalog in `problem_catalog`, `problem_catalog_content`, and the mirror-only `problem_catalog_detail`.
- **Jobs and Bookmarks:** `job_roles`, `job_stage_transitions`, `job_listings`, `resumes`, `kb_entries` without embeddings, and `weekly_reviews`.

Note versions, attachments, action events, files, recurrence series, and anything reached through Edge Functions stay on the server.

## Poke then pull

Something tells the mirror that the account changed, and the mirror reads the change feed past its own cursor. Pokes come from launch, this device's own commands, a Realtime insert on `action_events` for the account (except echoes of this device's commands), the app becoming active, the network coming back, and a one-minute timer. The following diagram shows one pull.

![One pull of the change feed: a poke enters a one-at-a-time queue; a copy that is not ready or whose cursor sits past the head bootstraps by reading the head cursor first and replacing every account table four at a time; otherwise the pull reads a page of manor_workspace_changes after the cursor, folds changes by key, skips rows whose local revision is current, re-reads the rest by identity, upserts returned rows and deletes missing ones, commits the page and cursor in one SQLite transaction, publishes the touched tables, and repeats for more pages.](../diagrams/svg/mirror-pull.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

- **The feed** is `manor_private.workspace_changes`: one row per changed row with a per-account contiguous cursor, the row's key fields, the kind of change (insert, update, delete, or purge), and its revision. It covers worker-written calendar tables that action history never sees. The app reads it through `manor_workspace_cursor` and `manor_workspace_changes`, which refuse agent tokens.
- **A pull never trusts the feed's contents**, only its ordering. It deletes by key and re-reads inserted or updated rows by identity, so a row is always what Postgres returns now.
- **Revisions only move forward.** A row whose local revision already matches is skipped, except `note_pages`, which is always re-read because opening a note moves `last_opened_at` without moving the revision, and rows that were removed and recreated in the same batch, whose natural keys restart their revision.
- **The cursor moves only after an apply commits**, so an interrupted pull repeats rather than skips. One pull walks at most 100 pages; beyond that the next pass rebuilds.
- **Bootstrap reads the head cursor before filling anything**, so a change committed during the fill lands after the recorded cursor and arrives with the next pull.
- **Failure handling.** Offline is what a local copy is for, so a connection failure keeps the mirror serving. Any other failure means the copy may be wrong, so reads return to the server until a pull succeeds.

`job_listings` has no feed trigger: cron refreshes it, so the mirror replaces it in full at launch and every hour, together with the job-role tables that depend on it.

## Serving reads

`MirrorFlags` decides per table whether reads come from disk. Account tables serve once the account copy is ready; catalog tables serve once the catalog copy is ready. Reads never wait for a pull. The mirror publishes the tables each pull touched through the gateway, and pages that show them reload from disk.

Derived state that Postgres computes, such as `manor_habits_state`, is cached in the mirror with the cursor and the account-local day it was computed for, and served only while both still match, so it is exact rather than stale.

## The shared catalog

The problem catalog is shared and too large to replace on every launch: its current metadata and content are tens of megabytes of JSON. `CatalogSync` runs beside the account sync, on the same pokes, through the same serial gate, so one writer touches the store.

- **Its own feed.** A trigger on `leetcode_problems` records each change to a catalog row in `manor_private.catalog_changes` under one contiguous cursor, read through `manor_catalog_cursor` and `manor_catalog_changes`. The views `problem_catalog` and `problem_catalog_content` give the mirror stable table names to re-read.
- **Snapshots.** When the catalog copy isn't ready, or trails the head by more than 5,000 changes, `CatalogSync` reads `catalog/manifest.json` from the private `manor-catalog` Storage bucket and, when the manifest is ahead, downloads the snapshot it names: gzip-compressed NDJSON with a header line `{"schema":1,"cursor":N,"problems":n,"contents":m}` and one `{"type":"problem"|"content","row":{…}}` line per row.
- **Verification.** The client checks the byte length and SHA-256 against the manifest before decompressing, the header against the manifest, the row counts against the header, and the gzip trailer, and refuses any mismatch. It streams the inflate in 1 MiB chunks and writes rows in batches of 500, then commits the snapshot's cursor and walks the feed from there.
- **Detail split.** Company reports and source snapshots go to the mirror-only `problem_catalog_detail`, so the index row stays small.
- **Publishing.** `tools/problem-import/catalog-snapshot.mjs` publishes a snapshot after each catalog import: it reads the catalog cursor before any row, streams both views through gzip, uploads the snapshot, and only then replaces the manifest, keeping the previous snapshot for clients still downloading it.

Until the catalog copy is ready, catalog reads use the server, so a first launch works before the snapshot lands.

## Sign-out

Signing out stops both syncs before the session closes, then deletes the account's mirror file and its WAL and shared-memory companions. A pass interrupted by the stop abandons its work instead of writing into a mirror the app has left.
