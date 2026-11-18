# Data and lifecycle

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

This slice covers how domain records are represented, how dates and recurrence work, what history keeps, and how Trash and purge remove content. The migrations in `supabase/migrations/` define the physical tables, keys, indexes, and transitions; an applied migration is never edited.

## Relational ownership

Domain records are relational; JSON is reserved for document content and genuinely flexible payloads. Stable IDs survived every migration, new IDs are collision-resistant, and constraints that affect persisted correctness live in the database.

| Domain | Representation |
|---|---|
| Accounts | Profile, saved time zone, and account settings, including Pomodoro preferences; identity from Supabase Auth |
| Tasks | Tasks, contexts, saved views, recurrence series, occurrence identities, scratch blocks |
| Habits | Definitions, lifecycle changes, dated entries, freeze intents, and derived streak and pool state |
| Mood and focus | One account-and-date record with independently loggable Mood and Focus |
| Pomodoro | Sessions with kind, status, label, planned length, start, pauses, end, focused seconds, and local date; a partial unique index allows one running or paused session per account |
| Problems | Shared catalog problems, immutable content versions, and private testsets; custom problems; practice state, saved views, attempts, mistakes, code drafts, and execution jobs and results |
| Jobs | The shared listings catalog; roles, stage transitions, and resume versions |
| Notes | Folders and pages, the [block document](notes-editor.md#document-format) with stable block IDs, revisions, versions, suggestions, and attachment references |
| Knowledge | Bookmarks and captures, file references, extracted text, and versioned embedding chunks |
| Reviews | Weekly reviews with their period, input snapshot, and generated content |
| Infrastructure | Command receipts, action events, change feeds, jobs, file lifecycle records, and purge tombstones |

## Dates and recurrence

Instants are time-zone-aware timestamps; date-keyed logs are dates. A task deadline keeps its local date in `tasks.due` and an optional `HH:MM` wall-clock time in `tasks.due_time`, interpreted in the saved account time zone; a constraint rejects invalid times, sparse edits keep an omitted time, and an explicit null clears it. The app computes today and yesterday in the account time zone with a Gregorian calendar that starts weeks on Monday (`AppContext.calendar`).

A unique occurrence key combines a series with its scheduled occurrence. Exceptions and completed or skipped outcomes are stored apart from the series definition. A scheduled generator materializes occurrences ahead of time and catches up after interrupted runs, with a watermark and unique constraints that prevent duplicates. Series edits use occurrence exceptions or an effective future-series boundary and never rewrite historical outcomes.

Streak and pool state are derived from entries and freeze intents rather than kept as a competing mutable truth. Historical mood and focus corrections use a dedicated account-authenticated command, `correct_mood_focus_history`, which agents can't call.

## Action history

Field-level action events are written in the same transaction as the change. Structural fields useful for behavior analysis are kept apart from content-bearing fields that get scrubbed. Secrets, full-document snapshots, and autosave keystrokes are never recorded. Client-reported provenance is distinguished from trusted server identity. Agents read history through the analysis tools; the app has no history page.

## Search and embeddings

Postgres text search handles exact retrieval and pgvector handles semantic retrieval through the `semantic-search` function. Notes and knowledge entries are embedded with OpenAI `text-embedding-3-small` at 1,536 dimensions (index version `text-embedding-3-small:1536:v1`), using `cl100k_base` tokenization and at most eight 1,500-token chunks per run. Jobs carry the source ID, content revision, and index version, so a stale result is discarded if the source changed or entered Trash, unchanged content is never re-embedded, and metadata-only edits advance the indexed revision without a request. Trash removes derived chunks, and restoring queues fresh indexing.

## Trash and purge

A deletion timestamp and server-computed eligibility implement seven-day Trash for tasks, applications, and notes. Queries and workers exclude trashed content unless they operate on recovery. Parent and child restore relationships are kept, and a stale queue can't recreate a deleted record.

After seven days, the maintenance job writes content-free tombstones to the purge ledger and waits until a backup has acknowledged the ledger (see [backups and recovery](backups-and-recovery.md)). Purge then removes source rows and content-bearing derivatives: document versions, files with no surviving references, text and vector indexes, action payloads, receipt payloads, queued job inputs, and stored errors containing source text. Action history keeps structure and loses titles and text. Compact receipts keep deduplication metadata but never return purged content on retry. Purge progress is persisted, so an incomplete step retries with an explicit failure status.

A note in Trash can also be deleted permanently on request. `purge_note` writes tombstones for the note and its trashed subpages and runs the same per-object purge in one transaction, without the seven-day wait or the backup acknowledgement, because the deletion is explicit. It is a user action only; the agent catalog offers Trash and restore, not purge.
