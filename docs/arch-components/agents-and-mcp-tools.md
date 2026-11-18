# Agents and MCP tools

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Agents operate Manor through a remote MCP endpoint: the `manor-mcp` Edge Function at `https://<project-ref>.supabase.co/functions/v1/manor-mcp`. Mutation authority and confirmation policy are in the PRD's [agents](../PRD.md#agents-and-background-work) section; the endpoint adds no approval workflow of its own.

## Endpoint and authorization

`manor-mcp` uses the MCP TypeScript SDK's streamable HTTP transport and OAuth 2.1 resource and authorization discovery backed by Supabase Auth's OAuth server. It verifies each token's signature, audience, and live grant, and the grant's scope decides access: a read grant lists and runs only read tools, and a read and write grant lists everything. Revocation in Settings takes effect on the next call. Resource access stays account-scoped even when a caller supplies another account's IDs, and an agent never receives a service-role credential. The consent step is in [auth and deep links](auth-and-deep-links.md#agent-consent).

Agents operate on committed data only. They have no access to the open window, selections, unsaved drafts, or presentation controls, and page content and imported documents are untrusted data, not instructions.

## The catalog

`supabase/functions/_shared/toolCatalog.ts` assembles the catalog from per-area catalogs (Notes, workspace, related records, lifecycle, Pomodoro, problem library, and problem execution) and defines each tool's JSON Schema, description, execution, and read-only flag. The catalog has 133 tools: 52 reads and 81 writes. Hosts read the list when they connect, so new tools appear without reconnecting. Tool annotations mark reads as read-only and `trash_`, `delete_`, and `remove_` tools as destructive.

| Area | Tools |
|---|---|
| Context and search | `get_workspace_context`, `get_day_overview`, `search`, `semantic_search`, `get_related_records`, `link_records`, `unlink_records` |
| Tasks and Home | `query_tasks`, `create_tasks`, `update_tasks`, `create_recurring_task`, `skip_task_occurrence`, `update_future_task_occurrences`, `trash_task`, `restore_task`, `list_contexts`, `create_context`, `update_context`, `remove_context`, `list_task_views`, `save_task_view`, `delete_task_view`, `query_calendar_events`, `query_scratch_blocks`, `save_scratch_block`, `delete_scratch_block`, `query_course_deadlines` |
| Habits and streaks | `query_habits`, `query_habit_history`, `get_streak_status`, `create_habit`, `update_habit`, `set_habit_status`, `log_habits`, `clear_habit_entries`, `apply_habit_freeze`, `clear_habit_freeze` |
| Mood and focus | `query_daily_records`, `log_daily_ratings` |
| Pomodoro | `query_pomodoro_sessions`, `start_pomodoro_session`, `pause_pomodoro_session`, `resume_pomodoro_session`, `end_pomodoro_session`, `log_pomodoro_session`, `update_pomodoro_session`, `delete_pomodoro_session` |
| Notes | `query_notes`, `read_note`, `read_note_blocks`, `find_in_note`, `create_note`, `update_note`, `move_note`, `duplicate_note`, `edit_note_blocks`, `move_note_blocks`, `duplicate_note_blocks`, `edit_note_media`, `propose_note_edits`, `query_note_suggestions`, `resolve_note_suggestions`, `list_note_versions`, `read_note_version`, `restore_note_version`, `import_note`, `import_markdown_note`, `export_note`, `archive_note`, `trash_note`, `restore_note`, `list_note_folders`, `create_note_folder`, `update_note_folder`, `remove_note_folder`, `remove_empty_note_folder` |
| Files | `prepare_file_upload`, `finalize_file_upload`, `get_file_status`, `list_files`, `get_file_download` |
| Jobs | `query_job_catalog`, `query_applications`, `add_applications`, `add_job_listing`, `update_applications`, `get_application_history`, `trash_application`, `restore_application`, `list_resumes` |
| Problems | `query_problems`, `read_problem`, `save_problem`, `import_problems`, `merge_problem_duplicates`, `unmerge_problem_duplicate`, `list_problem_views`, `save_problem_view`, `delete_problem_view`, `read_problem_draft`, `save_problem_draft`, `run_problem`, `submit_problem`, `query_problem_submission`, `list_problem_submissions`, `query_attempts`, `create_attempt`, `update_attempt`, `delete_attempt`, `query_mistakes`, `save_mistake`, `delete_mistake` |
| Knowledge | `query_knowledge`, `read_knowledge`, `save_capture`, `remove_capture` |
| Analysis and reviews | `get_metrics`, `query_action_history`, `get_weekly_review_input`, `save_weekly_review`, `query_weekly_reviews` |
| Lifecycle and status | `list_trash`, `trash_records`, `restore_records`, `archive_records`, `unarchive_records`, `get_operation_status`, `get_changes_since`, `get_background_run`, `retry_background_run`, `get_preferences`, `update_preferences`, `get_integration_status` |

There is no generic SQL or script executor, no purge tool, no tool for historical mood and focus corrections, and no tool that manages agent connections or notifications. Catalog problems are read-only to agents; a write that targets one returns `42501`.

## Contracts

- **Commands.** Every write runs through the same [command boundary](gateway-and-commands.md) as the app, with an idempotency identity, stable targets, expected revisions where needed, and typed changes. The adapter can generate and keep the identity for a logical request, so a retry after an uncertain response reuses it; `get_operation_status` resolves the uncertainty.
- **Results.** Every mutation returns an explicit outcome (`committed`, `accepted`, `conflict`, or a failure), affected IDs, committed revisions, and a bounded projection of changed data. Asynchronous work returns a run or upload ID and its state instead of waiting through unrelated processing.
- **Batches.** Domain batches are bounded and say whether they are atomic. Reads return IDs and revisions, so a later write can't touch records that began matching a filter in the meantime. Problem imports take at most 100 problems and return per-problem outcomes.
- **Notes.** Note tools read and edit Manor's [block document format](notes-editor.md#document-format) with stable block IDs and expected revisions. Edits confined to different blocks merge; overlapping edits return a resolvable conflict. A document is never replaced with generated Markdown to run an anchored edit. `import_markdown_note` converts Markdown on the server and returns the assets it still needs, which the `manor-import` skill uploads before importing again.
- **Aggregates.** Named metrics expose useful calculations with time zone, period, coverage, and definitions, so missing days aren't counted as zero.
- **Changes.** `get_changes_since` gives agents a compact durable cursor independent of Realtime; cursor expiry requires explicit resynchronization.

## Hosts

Any OAuth-capable MCP host can connect, including Codex, ChatGPT, and Claude. The personal Manor plugin for Codex holds the endpoint, branding, and the Manor and weekly-review skills, with no embedded credentials. A hosted ChatGPT connection needs its own registration and Manor authorization, and the weekly review's unattended run is verified separately (see the architecture's [status](../ARCHITECTURE.md#status)).

The weekly review uses a frozen input snapshot: the first `get_weekly_review_input` for a period captures an account-owned snapshot, and `save_weekly_review` requires that snapshot's ID, period, time zone, and watermark. The window is from the previous Sunday at 22:00 to the current Sunday at 22:00 in the saved time zone, resolved to instants so a week that crosses a daylight-saving change isn't assumed to be 168 hours. Same-period, same-content saves are idempotent, and a source purge invalidates the snapshot instead of silently rebuilding it.
