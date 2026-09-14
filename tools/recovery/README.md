# Manor recovery operations

_Last updated: 2026-09-13_

The recovery policy is the architecture's [backups and disaster recovery](../../docs/ARCHITECTURE.md#backups-and-disaster-recovery) section. These scripts orchestrate **restic 0.19.1** and **rclone 1.75.1**; they do not implement snapshot storage, encryption, retention, or transfer protocols.

## Provisioning

Use an independent managed S3-compatible or Backblaze B2 bucket and a restic repository encryption password. Keep the password in an independently recoverable secret store. The scheduler needs the source database connection, source Supabase S3 credentials, and backup repository credentials. It doesn't get the recovery target's database or Storage credentials; a restricted recovery operator holds those separately.

**Warning:** None of these credentials belong in the browser app or the MCP environment.

An existing backup bucket was not available during implementation: the Vercel project has no connected Blob store, the team's sole Blob store belongs to another app, and the authenticated Marketplace has no S3 product. No store was purchased or repurposed. Supabase generated S3 keys and independent backup credentials must be provisioned before activation. Vercel Blob is not a native restic/rclone repository backend; this workflow does not invent a compatibility service.

Install project tools with `python3 tools/recovery/install-tools.py` and `npm --prefix tools/recovery ci --ignore-scripts`. The installer checks SHA-256 values published with the pinned upstream releases. Add `tools/recovery/.bin` to `PATH`. Populate the environment using `.env.example` as the name inventory, without committing values. Initialize the empty destination once with `restic init`; initialization is deliberately separate from scheduled backups, so an inaccessible repository cannot silently become a new backup history.

Supabase Pro daily database backups remain a separate managed service. The management API reported seven completed production daily backups for September 3–9, 2026, with PITR disabled; staging had one completed September 10 backup. Verify the plan, successful backup timestamp, and seven-day retention in the Supabase dashboard before release. Storage contents are not included in those backups. This runner does not claim to have enabled Pro or to have completed a managed database restore.

## Daily operation

`npm --prefix tools/recovery run backup` prepares content-free purge intents, backs up the complete ledger under the `manor-ledger` tag, verifies the encrypted repository, and acknowledges exactly those intent timestamps. It then takes a repeatable-read file manifest, copies immutable source objects, checks SHA-256 and lengths, writes a pending snapshot, verifies it, labels it `manor-daily`, and prunes daily snapshots outside seven days. The latest complete ledger snapshot is retained independently of the daily retention window. No source deletion is propagated as a mutable backup mirror.

The manifest records owner, object ID, Storage object ID/version, immutable path, SHA-256, size, source cluster identity, SQL snapshot identifier, WAL location, and database timestamp. Managed database and file snapshots need not occur at exactly the same instant; restore validation rejects a selected file snapshot if any surviving database reference lacks matching bytes.

Copy `daily-backup.workflow.yml` into `.github/workflows/` only after configuring the protected `recovery` environment and secrets. The template schedules 06:17 UTC daily and permits a manual run. Enable failed-run notifications and separately monitor the scheduled job's last success; a scheduler that never starts cannot report its own failure. `npm --prefix tools/recovery run status` fails if no snapshot exists or the newest daily snapshot is older than 30 hours. The application is not advertised as protected until a real remote run and isolated restore have passed.

## Isolated restore

1. Restore the chosen managed database backup into a **separate Supabase recovery project**, with all ingestion, outbound integrations, scheduled review generation, and user access disabled. Apply current recovery migrations there before reconciliation. Prepare an empty private `manor-files` bucket in that project.
2. Set the restore-only environment values and an explicit full `MANOR_RECOVERY_SNAPSHOT` ID. Keep the source configuration for identity checks; the source database does not need to be online.
3. Run `npm --prefix tools/recovery run restore`. It checks the repository, restores the explicit daily snapshot and latest independent ledger, rejects the production database cluster identity, applies content-free purge tombstones, verifies every remaining database file reference, copies only matching files, and downloads them again for comparison. It never enables app access or workers.
4. Before enabling access, verify account ownership, parent-child relationships, representative module reads, and row counts against the chosen database backup. If any reconciliation or file check fails, keep recovery isolated and investigate the specific missing recovery point.

`npm --prefix tools/recovery test` exercises real local restic/rclone transfer, encrypted restore, wrong-key rejection, byte-tamper detection, and actual expired-snapshot pruning using synthetic files only. This is not a substitute for the remote database-plus-files rehearsal.
