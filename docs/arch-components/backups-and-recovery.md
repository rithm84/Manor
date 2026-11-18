# Backups and recovery

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Daily database backups and daily file backups with seven-day retention give a recovery point of about one day, contingent on successful runs. This is not zero data loss or instant recovery, and point-in-time recovery isn't used.

## Recovery points

- **Database.** Supabase Pro takes a managed daily backup of Postgres. It excludes Storage object contents, and restoring a live database involves downtime.
- **Files.** `tools/recovery/` copies Storage objects with pinned restic and rclone into an independent S3-compatible bucket. Each file manifest records object IDs and versions, immutable paths, SHA-256 values, sizes, ownership, and the database watermark needed to reconcile references. Every retained recovery point keeps the file versions it needs; a mirror is never overwritten, and source deletions aren't propagated into backups at once.
- **Purge ledger.** Purge writes content-free tombstones first, and physical deletion waits until a backup has acknowledged the ledger, so a restore can reapply deletions newer than its snapshot. The ledger is kept independently recoverable.

Backups are encrypted, and restore credentials are separate from app credentials. Operational backups can contain deleted content until they expire; they are restricted recovery material, not a user-visible archive or a tool-accessible source.

## Isolated restore

A restore runs in a separate Supabase recovery project with ingestion, outbound integrations, review generation, and user access off. The tooling restores the chosen managed backup, applies purge tombstones newer than it, copies only files whose checksum matches a surviving database reference, downloads them again for comparison, and refuses to run against the production database. Account ownership, relationships, representative reads, and row counts are verified before any access is enabled. A failed restore or missing daily backup is reported as a gap, never papered over with an older recovery point presented as current.

## Status

The scripts, their local encrypted snapshot and restore tests, and the daily workflow template exist. Independent backup storage credentials, activating the schedule, and a full remote database-plus-files restore rehearsal are outstanding. [`tools/recovery/README.md`](../../tools/recovery/README.md) covers provisioning and operation.
