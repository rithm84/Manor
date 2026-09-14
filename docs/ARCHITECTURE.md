# Manor architecture

_Last updated: 2026-09-13_

Manor is a macOS desktop app: a React frontend built with Vite inside a Tauri shell, with Supabase behind it. This page describes how the pieces fit together, the rules each part follows, and what remains to verify. Product behavior lives in the [PRD](PRD.md) and the visual direction in the [design charter](DESIGN.md).

## Status

The production Supabase project carries all 50 migrations applied over the preserved Electron-era data, the eleven Edge Functions, the four `manor-*` schedules, Google-only Auth with both hooks and the OAuth server, and the migrated resume and capture files. The legacy functions and schedules are removed, and the app installs and updates from Manor's GitHub Releases. The app has a Vite entry point, Supabase view adapters, transactional commands, account-scoped query refresh, and the redesigned light and dark interface. The Notes editor includes native columns and tabs, durable browser drafts, attachment queues, conflicts, versions, and suggestions.

Verified in staging:

- The remote MCP endpoint passes synthetic OAuth dynamic registration, PKCE authorization-code exchange, resource-audience validation, read and write tool access, idempotent Notes import, find, export, duplication, relationships, change-feed catch-up, atomic Trash batches, write-scope downgrade, token refresh, and immediate revocation.
- Google-only signup gating and the OAuth token hooks are on with their persisted configuration checked, and interactive Google sign-in completes on the hosted staging site.
- Google Calendar and X accounts are connected: the calendar job resyncs at each minute boundary and the X job completes without errors. Integration and jobs workers use dedicated worker authentication.
- Attachment tools enforce account ownership and live OAuth grants; a real private-file upload with interruption, retry, finalization, and byte-for-byte download passed.
- Jobs ingestion populated the staging catalog. Embedding activation and synthetic OpenAI indexing and search checks passed, including stale-result rejection, unchanged-text reuse, and Trash exclusion.
- Integration, jobs, embeddings, and maintenance schedules are active. Function access is restricted to the app's webview origin; the dev origin and website return URLs are off.
- Database daily backup metadata is verified. File recovery tooling has local encrypted snapshot and restore checks and staging purge-checkpoint verification.
- The staging desktop app completes a session from a verify link delivered as a deep link on its URL scheme (the Google leg is not verifiable in staging, see below), keeps its session and window state across relaunches, opens from a closed state onto the route a deep link names, runs commands, saves Notes, opens outside links in the default browser, starts a Google Calendar connection from the desktop origin, receives the callback's refusal path as a `manor-staging://settings` route, approves an agent's connection request that arrived as a deep link and hands the browser the agent's callback with its code, and installs a signed 0.1.1 release from the staging feed over an installed 0.1.0 and relaunches into it.

Still open before release: registering the staging Supabase callbacks on the Google OAuth client (Google currently answers staging sign-in and calendar consent with a redirect mismatch, so those flows are verified up to Google's page), native agent-host verification against the production endpoint, reconnecting the X account whose legacy token production rejects, independent remote backup storage credentials, and a complete remote database-plus-files restore rehearsal. Migration bookkeeping is reconciled in both projects (50 versions recorded, every web migration source matching its stored hash); a replay from an empty database is unverified. The exact inventory is in [current-status.json](../tools/recovery/current-status.json). A deployment existing is not evidence that a check passed; the list above is the evidence.

React, TypeScript, Vite, React Router, and BlockNote are the application stack. Supabase adapters, TanStack Query server state, and IndexedDB draft protection sit at the web boundary. View-service interfaces are UI dependencies; migrations and the shared tool catalog define the transactional contracts. A future iOS client can call the same backend operations directly.

## Runtime and deployment

The following diagram shows the deployed pieces and the paths between them.

![Runtime and deployment: the Manor app inside the Tauri desktop shell, updated from GitHub Releases, talks to Auth, Postgres, and Storage in one Supabase project; agent hosts reach the manor-mcp function over OAuth 2.1; workers driven by cron read Google, X, SimplifyJobs, and OpenAI.](diagrams/runtime.svg)

### Desktop app

The `desktop/` directory holds a Tauri 2 shell that bundles the Vite build and runs it in the system webview at the `tauri://localhost` origin, so the app boots from local assets and keeps its IndexedDB drafts without a network. Rust owns only the native shell: the window with an overlay title bar that stays hidden until the frontend has applied the saved theme and dispatched its first render (the shell shows it after four seconds if the frontend never asks), deep-link receipt, forwarding a second launch to the running instance, opening outside links in the default browser, remembering the window size and position, file logging under the app's log directory, the updater and the relaunch after an update, and one command that tells the frontend which URL scheme the build owns and when the process started. Closing the window hides it and keeps the app running, so the Dock icon or a link reopens it at once with the account already loaded; Quit ends the process. Business logic stays in the frontend and the backend.

The frontend reaches the shell through one object: it opens authorization pages in the system browser, turns deep links into app routes, and sends links that leave the app to the browser. A deep link `<scheme>://<host><path>?<query>` is the route `/<host><path>?<query>`: `/auth/callback` completes sign-in, `/oauth/consent` opens an agent's connection request, and every other route navigates inside the app, which is how the integration callback returns to Settings. A route that arrives before the router exists, including the one the app was launched with, is applied once the signed-in router mounts. Production and staging are separate identities (`Manor` with the `manor` scheme and the `app.manor.desktop` identifier; `Manor Staging` with `manor-staging` and `app.manor.desktop.staging`), so both can be installed side by side with separate webview storage, and a link for one environment never opens the other app. The shell's content security policy allows only the bundled assets, the Supabase hosts, and https media and embeds.

Supabase hosts authoritative data, authentication, private files, realtime changes, and backend jobs. There is no second general-purpose API server. External credentials and privileged operations belong in server-side functions.

### Releases and updates

A release is a signed build published to GitHub Releases by `npm --prefix desktop run release`: the script builds the production identity, signs the archive with the key kept outside the repository, writes the `latest.json` feed for `darwin-aarch64`, and creates the `v<version>` release that `releases/latest/download/latest.json` then serves; `release:staging` replaces the assets of the rolling `staging` prerelease instead. The version is the one in `app/package.json`. The app checks the feed for its identity on launch, every hour, and when the window regains focus after an hour, then shows **Restart to update**; open dialogs and Notes edits not yet protected in IndexedDB block the restart, and an archive is installed only with a valid signature for the public key in `tauri.conf.json`. A person installs by extracting the archive into Applications. Details are in [desktop/README.md](../desktop/README.md).

### Environments and releases

Staging and production are separate Supabase projects with independent accounts, rows, storage, secrets, integration tokens, and job queues. Desktop builds pair with them: the staging identity is built with staging configuration and signs in against the staging project, and the production identity against production. Staging holds synthetic data, and staging jobs never consume production integration accounts. Local development has no authorized backend: it covers unauthenticated UI work, typecheck, and unit tests. Signed-in and end-to-end verification runs on a staging build bundle rather than the shell's dev server, because macOS delivers deep links only to a bundled app and the dev server origin is not an authorized backend origin.

Configuration is environment-scoped with stable staging callback URLs for OAuth. Only publishable connection values are in the bundle.

A production release uses production configuration; a staging bundle with baked-in staging settings is never published as a production release. Migrations are rehearsed in staging, then the approved migration is applied to production and the compatible release published. Code and database changes roll back separately: publishing an older release does not undo database writes.

### Code organization

One repository holds the application UI, pure domain logic and contracts, Supabase adapters, remote MCP registration, and Notes persistence, with backend functions and migrations under `supabase/` and the desktop shell under `desktop/`. Types and validation are shared where runtimes permit; browser modules never import Node filesystem code.

## Authentication and authorization

People and agents authenticate differently and end at the same row-level policies, as the following diagram shows.

![Sign-in and agent authorization: a person passes Google sign-in and the signup gate, whose grant the before-user-created hook requires; an agent client completes OAuth 2.1 discovery and the Manor consent screen to get a scoped token; both reach row-level security and the 112 operations.](diagrams/auth.svg)

Supabase Auth uses Google as the only sign-in provider. Email and password, magic link, phone, and anonymous entry paths are off, and Manor has no password creation, reset, or verification email of its own, so no SMTP provider is needed. Google supplies the verified email identity, and a new account requires it. A Google Web application OAuth client is registered with each environment's exact Supabase callback, the corresponding Manor return URLs are allowlisted, and the client secret stays server-side. Calendar authorization is a separate consent from sign-in ([Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google)).

The app cannot complete Google sign-in inside its webview, so it starts the PKCE flow with the build's deep link as the return URL, opens the authorization page in the system browser, and exchanges the code when `<scheme>://auth/callback` arrives; a verify link that returns session tokens in the fragment completes the same way, and a refused sign-in shows its reason on the sign-in panel. The return URLs (`manor://auth/callback` in production, `manor-staging://auth/callback` in staging) are the only allowlisted ones, and the webview keeps the session as a browser would. Agent consent takes the same road: the OAuth server's site URL is the build's scheme, so an authorization request sends the browser to `<scheme>:/oauth/consent?authorization_id=…`, the app shows the consent dialog to the signed-in owner, and the approval or refusal answers with the agent's return address, which the app opens in the browser. The OAuth server accepts those consent calls only from an origin on the redirect allowlist, so the webview origin `tauri://localhost` is listed there next to the sign-in return URL.

The signup gate runs before account creation. The server validates the shared gate password with rate limits against a stored hash; the password never appears in user metadata, URLs, or logs. A short-lived, single-use, server-recorded grant binds a successful gate check to the intended Google email, and the verified OAuth identity has to match it. The before-user-created hook rejects any account creation without a valid grant, including direct Auth API and OAuth requests, and the grant is validated and consumed server-side rather than trusted from client-editable metadata. The gate is tested with first Google login, returning users, account switching, mismatched Google emails, replay, and interrupted OAuth. A UI-only gate after Supabase account creation would not satisfy the product requirement ([before-user-created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)).

For ordinary data:

- Account identity comes from verified authentication, never from a supplied owner ID. Exposed tables have explicit grants and owner-scoped row-level security written as `user_id = (select auth.uid())`, so the check runs once per statement, with an index on every policy column. Same-owner relationships are enforced by constraints as well as application validation.
- Reads, aggregate queries, storage requests, and commands are all authenticated. Views preserve the caller's authorization; a convenience view never bypasses row-level security.
- Direct table writes cannot bypass command validation, revisions, deduplication, or history. Functions use invoker privileges where sufficient; privileged functions have narrow execution grants, fixed search paths, explicit ownership checks, and a least-privilege owner. There is no general privileged database endpoint ([database function security](https://supabase.com/docs/guides/database/functions)).
- Integration credentials, queue controls, signup grants, and infrastructure records are not client-readable. Service-role keys stay server-side, and workers receive only the data and capabilities their job needs.
- Remote MCP uses a scoped, revocable OAuth authorization for the account; Google client credentials are not MCP credentials. The adapter enforces the shared operation boundary, there is no agent superuser, and caller-supplied provenance is context, not proof of authorization or actor identity.

A completed sign-out clears authenticated query caches and subscriptions after the pending-draft guard runs (see [Notes drafts and editing](#notes-drafts-and-editing)). Session expiry is different: local drafts stay, authenticated operations stop, and the same account has to reauthenticate before they replay.

## Data model and commands

### Relational ownership

Domain records are relational; JSON is reserved for structured document content and genuinely flexible payloads. Existing stable IDs survived migration rather than being renumbered, new IDs are collision-resistant, and domain constraints live in the database where they affect persisted correctness. The following table lists the logical representation of each domain; the migrations define the physical tables, keys, indexes, and transitions.

| Domain | Technical representation |
|---|---|
| Accounts | Profile, saved time zone, account preferences; authentication identity supplied by Supabase |
| Tasks | Tasks, context references, saved views, recurrence series, occurrence identities, independent scratch blocks |
| Habits | Habit definitions, lifecycle changes, dated entries, freeze intent and derived streak and pool state |
| Mood and focus | Unique account-and-date record with independent ratings and one versioned synthesis |
| LeetCode | Stable curriculum problems, dated attempts preserving source text, separate mistakes notes |
| Jobs | Shared source catalog; owner-specific roles, stage events, resume references and versions |
| Notes | Folder and page relationships; lossless BlockNote JSON with stable block IDs; page revisions and attachment references |
| Knowledge | Source entries, supplied capture content, file references, extracted search text, versioned embedding chunks |
| Reviews | Account and review-period record, input watermark, generation state, generated content, model metadata |
| Infrastructure | Command receipts, meaningful action events, jobs, file lifecycle records, purge tombstones |

Module rules are in the PRD's [streak system](PRD.md#streak-system) and [modules](PRD.md#modules) sections.

### Shared command boundary

UI actions and remote MCP calls invoke the same named operations. TypeScript contracts and runtime validation give consistent inputs and results, and server-side enforcement is authoritative. Database-only mutations are transactional RPCs; external operations use Edge Functions and durable jobs and return an accepted job or file state when completion is asynchronous. The following diagram shows one command's path, including a retry.

![The command boundary: a caller sends a command id, operation, input, and expected revision; the server validates and authorizes, checks the revision, applies rows, action events, and a receipt in one transaction, and returns the committed record or a conflict; a retry with the same command id replays the receipt.](diagrams/commands.svg)

History and receipts serve different purposes: history explains meaningful changes, receipts resolve uncertain delivery. Competing writes are serialized with version checks and database locking, and a conflict response carries enough current state to resolve it without silently overwriting newer data. Related mutations use explicit atomic batches; independently processed bulk items return each item's result and stable command ID rather than disguising partial success as an atomic outcome.

### Dates and recurrence

Instants are stored as time-zone-aware timestamps and date-keyed logs as dates. Business dates come from the account time zone in the PRD, with the same clock rules in browser hints and server validation. A unique occurrence key combines the series identity with its scheduled occurrence identity, and exceptions plus completed and skipped outcomes are stored separately from the series definition.

Historical mood and focus corrections use a dedicated account-authenticated command with date and revision checks that preserves synthesis fields and records ordinary action history. That command rejects OAuth agent clients and is not in the MCP catalog; the History editor owns this exception to the daily capture window.

A scheduled generator materializes occurrences ahead of time and catches up after interrupted runs; its watermark and unique constraints prevent duplicates. Series edits implement the PRD's recurrence rules with occurrence exceptions or an effective future-series boundary and never rewrite historical outcomes. Streak reconciliation derives state from source entries and intent instead of maintaining a competing mutable truth.

## Queries, realtime, and MCP

### Reads and cache consistency

TanStack Query owns browser server state. Query keys include the account identity and filter or page parameters. Reads use server-side filtering, deterministic ordering, cursor pagination for growing collections, and bounded aggregate queries; a local change never reloads an entire module or invalidates the whole app.

At boot the shell starts the account load, the App chunk, the current route's chunk, and the route's first reads together, so a warm page has its data in flight before React mounts it. A device that has opened the account before renders from the cached account immediately and adopts the profile's name and time zone when they return; the splash in `index.html` paints the mark in the saved theme before any bundle loads. Committed records returned by a command are applied to the initiating browser's cache immediately. Realtime events carry account-authorized change notifications to other tabs and views, which invalidate or refetch the relevant queries; the `action_events` table is in the realtime publication, row-level security scopes its rows to their owner, and a tab ignores the echoes of commands it issued itself. Reconnect and window-focus reconciliation recover missed notifications, because Realtime is not a durable history. Stale versions arriving after newer ones are ignored, and drafts are protected separately from cached server records. Measured load timings and the criteria behind them are in [Performance](PERFORMANCE.md).

Tool success means persisted success: an optimistic visual state, where used, stays distinguishable from confirmed saving.

### Remote MCP adapter

Tool contracts cover the capability scope in the PRD's [agent tools section](PRD.md#codex-agent-tools-and-background-work) with explicit schemas, stable IDs, record versions, bounded results, searchable filters, and structured errors, including targeted note and block operations and domain batches. Asynchronous work returns job IDs and status rather than waiting through unrelated processing or reporting completion early. Mutation authority and confirmation policy belong to the PRD; the adapter adds no duplicate approval workflow. Page content and imported documents are untrusted data, not instructions or authority grants.

The shared operations are exposed through an authenticated HTTPS MCP endpoint built on a maintained MCP SDK and OAuth 2.1 resource and authorization discovery, using Supabase Auth's OAuth server. Resource access stays account-scoped even when a caller supplies another account's record IDs, and an agent never receives a Supabase service-role credential ([Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth)).

Remote calls operate on committed data and return revisions and receipts through the same command boundary. They have no access to open tabs, selections, unsynced drafts, or presentation controls; Realtime and refetch update open clients without overwriting drafts.

### Current tool coverage and host connection

The [shared catalog](../supabase/functions/_shared/toolCatalog.ts) contains 113 executable operations (47 reads and 66 writes). Remote MCP exposes their individual names and restricts read-only grants to reads. Repeated constraints use standard JSON Schema references and shared constraints, and per-operation server validation is authoritative. There is no live-browser transport.

Workspace, calendar, and habit retrieval, named metrics, command status, a content-free change cursor, current integration-job status and retry, record links, safe preferences, saved task views, precise Notes duplication and media operations, and atomic cross-module lifecycle batches are implemented. Some accepted names share operations: `update_tasks` completes and reschedules tasks, `set_habit_status` manages habit lifecycle, and `update_applications` changes stages and resumes. `query_weekly_reviews` accepts an ID for a single review.

Known limits: agent import and export support lossless `block_json`, not Markdown; automatic bookmark-preview fetching needs a controlled egress and extraction boundary before arbitrary URLs can be fetched safely; job status covers current Google and X synchronization jobs, not a historical run archive. These limits also appear in tool descriptions or workspace restrictions. Notes lifecycle guards inspect descendants and nested batch targets.

Five staging rollback suites cover workspace queries, Notes tools and attachment retention, relationship ownership and purge, weekly snapshots, and atomic lifecycle operations. Synthetic remote MCP tests also verify discovery, schema routing, successful writes, retry receipts, scope enforcement, refresh, and revocation. These checks don't prove every hosted-client workflow.

The personal Manor plugin is installed from `~/plugins/manor` through the personal marketplace. It contains the OAuth endpoint, branding, and the Manor and weekly-review skills, with no embedded credentials. Hosted ChatGPT Work needs its own registered connection and Manor OAuth authorization; a local installation doesn't establish hosted or mobile availability. The staging endpoint is `https://cysdooljdslgvqrahymm.supabase.co/functions/v1/manor-mcp` and the production endpoint is `https://pxdxqueevzttpmxjsqes.supabase.co/functions/v1/manor-mcp`. The documented hosted registration flow uses ChatGPT Plugins; an equivalent desktop registration control is unverified, and the registered hosted connection ID, hosted skill mapping, and unattended review execution are pending ([direct MCP connection and testing](https://developers.openai.com/plugins/deploy/connect-chatgpt), [plugin packaging](https://developers.openai.com/plugins/build/plugins)).

After connecting the hosted account, the checks are a manual read and authorized write, then the Sunday schedule with Manor and the laptop closed. Cloud Work supports continuing a chat from mobile; connection availability and permissions are checked in that chat ([hosted MCP](https://learn.chatgpt.com/docs/extend/mcp), [cloud and mobile Work](https://learn.chatgpt.com/docs/get-started-with-work#choose-local-or-cloud-work), [scheduled connected tools](https://learn.chatgpt.com/docs/automations#manage-scheduled-tasks-on-the-web)).

### Accepted tool surface

Tools provide deep operations with minimal intermediate calls: bounded domain batches, committed state returned directly, and no mandatory discovery, preview, or confirmation round trips when targets and intent are already clear. The catalog is explicit, schema-validated domain tools plus a few workflow commands. The operation layer owns behavior and remote MCP adapts it to its hosts; no module has to be opened to unlock its tools, and there is no generic SQL or script executor. The accepted target in the following table is broader than the registered tools in places; the gaps are the limits listed earlier.

| Capability | Accepted capability catalog | Contract focus |
|---|---|---|
| Workspace context | `get_workspace_context`, `get_day_overview` | Saved time zone and local date, recently opened objects, capability version, and connectivity. Compact context; content is fetched only when needed. |
| Cross-module retrieval | `search`, `get_related_records` | Text and semantic search with module and date filters, source IDs, snippets, revisions, and cursors. Relationships are explicit links or labeled retrieval matches, not invented associations. |
| Tasks and contexts | `query_tasks`, `create_tasks`, `update_tasks`, `complete_tasks`, `reschedule_tasks`, `skip_task_occurrence`, `list_contexts`, `create_context`, `update_context`, `remove_context`, `list_task_views`, `save_task_view` | Typed fields, bounded batches, exact occurrence identities, and version checks. Explicit this-occurrence or this-and-future scope, preserving history. |
| Home scheduling | `query_calendar_events`, `query_scratch_blocks`, `create_scratch_blocks`, `update_scratch_blocks`, `delete_scratch_blocks` | Calendar reads are distinct from Manor-only scheduling writes. Exact instants and durations plus account-local dates; never an implicit provider write. |
| Habits and streaks | `query_habits`, `query_habit_history`, `create_habit`, `update_habit`, `pause_habit`, `resume_habit`, `retire_habit`, `reactivate_habit`, `log_habits`, `clear_habit_entries`, `spend_freeze`, `release_freeze`, `get_streak_status` | Explicit dated logs and lifecycle commands; derived streak and pool outcomes returned with the write. No permanent habit deletion or bypass of backfill rules. |
| Mood, focus, debrief | `query_daily_records`, `log_daily_ratings`, `update_daily_synthesis`, `commit_debrief` | `commit_debrief` atomically applies the revised synthesis and any explicitly supplied ratings for one allowed date. No mandatory transcript or per-session summary; revision-aware editing preserves the existing synthesis. |
| Notes retrieval and organization | `query_notes`, `read_note`, `read_note_blocks`, `find_in_note`, `create_note`, `update_note_metadata`, `move_note`, `duplicate_note`, `list_note_folders`, `create_note_folder`, `update_note_folder`, `move_note_folder`, `remove_empty_note_folder` | Outline, selected sections, and full reads are explicit bounded projections. Note hierarchy is preserved; folder removal does not imply deletion of its contents. |
| Notes content | `edit_note_blocks`, `move_note_blocks`, `duplicate_note_blocks`, `propose_note_edits`, `query_note_suggestions`, `resolve_note_suggestions`, `list_note_versions`, `read_note_version`, `restore_note_version`, `import_note`, `export_note` | Typed edits for insertion, removal, anchored text changes, formatting, conversion, list, toggle, and check state, table rows and cells, and supported column and tab containers. Suggestions keep anchored changes and base revisions until resolved; version restoration creates a new revision. Cross-note movement is one operation with both base revisions. Imports and exports declare unsupported conversions. |
| Files and media | `begin_file_upload`, `finalize_file_upload`, `get_file_status`, `get_file_access`, `attach_note_media`, `update_note_media`, `replace_note_media`, `refresh_bookmark_preview` | Durable file IDs, explicit media state, and precise caption, alt, crop, and layout fields. File bytes use an authorized upload channel; a tool argument containing a local filesystem path gives the website no file access. |
| Job applications and resumes | `query_job_catalog`, `query_applications`, `add_applications`, `update_applications`, `change_application_stage`, `get_application_history`, `list_resume_versions`, `create_resume_version`, `set_application_resume` | Explicit pipeline admission, stage corrections, owned file references, and resume versions. Adding from the catalog accepts stable listing IDs; manual roles use the same validation. |
| LeetCode | `query_curriculum`, `query_attempts`, `log_attempt`, `update_attempt`, `delete_attempt`, `query_mistakes`, `create_mistake`, `update_mistake`, `delete_mistake` | Exact solution text is preserved and each attempt is separate from its stable problem. Updated progress, intensity, and streak implications are returned. |
| Knowledge and captures | `query_knowledge`, `read_knowledge`, `create_capture`, `update_capture`, `link_records`, `unlink_records` | Source-independent supplied content, stable attachment IDs, provenance, and extraction and index readiness. Linking never silently copies content across lifecycle boundaries. |
| Analysis and reviews | `get_metrics`, `query_history`, `get_weekly_review_inputs`, `save_weekly_review`, `read_weekly_review`, `list_weekly_reviews` | Named metrics and bounded dimensions and date ranges, with sample and coverage counts and missing-value semantics. Review inputs are revision-marked, and the review write is idempotent and source-attributed for the exact period. |
| Recovery and operation status | `list_trash`, `trash_records`, `restore_records`, `archive_records`, `unarchive_records`, `get_operation_status`, `get_changes_since`, `get_background_run`, `retry_background_run` | Module-specific lifecycle allowlists; only eligible account jobs can be retried. A compact durable revision cursor supports catch-up independently of transient Realtime and narrative history; cursor expiry requires explicit resynchronization. |
| Course deadlines | `query_course_deadlines` | Live read of the saved Canvas calendar feed link between two dates, at most 60 days: course, title, deadline, and link, parsed in memory and never stored. Managing the link is a Settings action; agents only read. |
| Preferences and status | `get_preferences`, `update_preferences`, `get_integration_status` | Safe appearance and view preferences are separate from time-zone changes and credential or account management. No secrets are returned. |

`get_workspace_context` also reports the implemented capability and schema version and the current restrictions, so optional features are never advertised before they work. Descriptions are published through the host's normal discovery mechanism; there is no second natural-language command router, and unsupported operations return specific errors instead of approximations.

### Workflow composition and response semantics

Domain batches reduce round trips: creating several tasks, rescheduling selected occurrences, or applying a group of note edits is one bounded call, and each batch contract states whether it is atomic. Database-only workflow commands can be atomic; a file upload plus a database write cannot claim the same guarantee. A complete atomic batch is validated before it is applied, and there is no mandatory preview or confirmation call.

Mutation inputs carry an idempotency identity, stable targets, expected revisions where needed, typed changes, and optional source references. The adapter can generate and retain the identity for a logical request, and a retry after an uncertain response reuses it. A receipt returns the original outcome while identifying its committed revision, and newer cache state never regresses to that older receipt. Aborting a browser request does not establish that the server mutation rolled back; `get_operation_status` resolves the uncertainty.

Every mutation returns an explicit outcome (`committed`, `accepted`, `conflict`, or a failure), affected IDs, committed versions, and a bounded projection of changed data; asynchronous responses add a run or upload ID and readiness state, and results include a useful object link where applicable. A committed result stays committed if the originating view disappears before rendering.

Committed results are applied to the relevant query cache and active editor while caret, selection, scroll position, and unrelated unsaved work are preserved. A local draft version and its cloud base version are distinguishable in reads and selections. Changes confined to different blocks can merge; overlapping edits return a resolvable conflict. A document is never replaced with generated Markdown to execute an anchored text edit.

Bulk targets are bounded and unambiguous: reads return IDs and versions so a later write cannot touch records that began matching a filter in the meantime. Named aggregate queries expose useful calculations without arbitrary SQL and include time zone, period, data coverage, and definitions so missing days are not counted as zero. Reads and navigation don't enter action history.

Example compositions:

- **Email to tasks.** Codex reads its email integration, finds relevant existing tasks, then submits a task batch with optional source references. Manor has no email-specific task command.
- **Voice debrief.** Read the day's combined context, then `commit_debrief` with the synthesis update and explicitly stated ratings. Habit and task changes from the same conversation use their own batches; no transcript is stored.
- **Edit this paragraph and add a screenshot.** Locate the target blocks with `find_in_note` or `read_note_blocks` (revision-bound), finalize the supplied asset through the supported upload path, then apply an anchored content edit and media insertion. Block IDs come back so the result can be cited.
- **Explain a pattern.** Query dated metrics plus meaningful history and source records; Codex interprets them. No second backend model call is needed.

The MCP transport does not supply Manor's persistence, transactions, retry receipts, or background scheduler; those live in the command boundary. These tools never expose unrestricted infrastructure controls or Codex conversation and notification management.

### Search and embeddings

Postgres text search handles exact and content retrieval and pgvector handles semantic retrieval. Results include source IDs, revision identifiers, and snippets, with full records fetched on demand. Only authorized, live content is indexed.

Embedding jobs carry a source ID, content revision or hash, and model and index version. Stale results are discarded if the source changed or entered Trash, unchanged content is never re-embedded, deterministic extraction is stored separately from model output, and the indexes are derived data rebuildable from retained sources.

Notes and Knowledge are indexed automatically with separately billed OpenAI `text-embedding-3-small` embeddings at 1,536 dimensions; the index version is `text-embedding-3-small:1536:v1`. The worker uses `cl100k_base` tokenization, lossless Unicode boundaries, at most eight 1,500-token chunks per run, and a durable source offset. Metadata-only changes advance indexed revisions without another embedding request, Trash removes derived chunks, and restoration queues fresh indexing. Provider-reported token usage is recorded per request in a private table. Synthetic staging checks cover semantic retrieval, stale commits, unchanged content, Trash, and restoration.

## Notes drafts and editing

A versioned BlockNote-compatible document is the lossless source format. Every editable nested block, including content in columns and tabs, has a stable address and a consistent schema, so nested content stays visible to search, selection, undo, and agent operations. Markdown is a lossy import and export representation; the supported editing features are in the PRD's [Notes section](PRD.md#notes). The following diagram shows how typing reaches the server and what happens when it can't.

![Notes drafts and saves: every change is written to an IndexedDB draft with a base revision and mutation id; a per-note queue sends one update_note at a time; a committed save re-bases or clears the draft; a moved revision merges by block against the base version and opens Compare versions only when the same block changed on both sides; attachment bytes upload resumably and the finalized file id joins the next save.](diagrams/notes-drafts.svg)

IndexedDB holds account-scoped drafts, base revisions, ordered pending mutations, and pending attachment bytes. A draft change is persisted locally before the app claims local protection, and cloud commit is indicated separately. Quota or persistence failures are visible; a browser cache is not a backup. Account-scoped cached profile and Notes state support reopening after an explicitly classified network transport failure, while authentication, authorization, and other server errors propagate instead of being treated as offline. A production-build reload with network access blocked preserves the document and shows the offline banner even when the browser's connectivity flag is wrong.

Releases never interrupt editing: the update notice refuses to restart while a dialog is open or a Notes edit is not yet protected in IndexedDB (see [releases and updates](#releases-and-updates)).

Only one browser writer replays a given document queue at a time, and within that tab the saves for one note run strictly in order so each replay reads the base revision committed by the save before it. Tabs are coordinated and idempotency survives reloads. The revision a device knows for a note only moves forward: a refetch that started before a save returns older rows, and those never replace the newer copy the device already holds. When a save reports a moved revision, the client re-bases at the block level. It fetches the version the draft started from (the server keeps every superseded version) and merges the draft with the server document by stable block id: edits to different blocks combine, a reordering by one side is kept, and the foreign blocks are applied to the open editor as block operations so the cursor and undo history in other blocks survive. The merged draft is then sent again. A block changed differently on both sides, a block one side edited and the other removed, both sides reordering, or both sides retitling is a real conflict, and **Compare versions** opens with both copies. Agent operations use stable block IDs and expected versions, and a refetch never overwrites unsaved keystrokes.

After a cloud-save failure, Notes navigation verifies that the exact current draft is committed in IndexedDB before another note or scope opens. The failed draft and attachment bytes stay protected, with a notice linking back to the note for retry. Actions that need cloud consistency keep their save guard, and failed local protection blocks leaving the note.

### Suggestions and document versions

Requested suggestions are stored separately from accepted content with stable block and text anchors, the proposed operations, the base revision, and resolution state. Direct editing is the default. Accept and reject are atomic domain commands with revision checks; a stale overlapping suggestion surfaces a conflict instead of applying to unrelated text. Pending suggestions survive reload, navigation, and sign-out.

Meaningful document versions are retained for the seven-day history UI rather than a snapshot per keystroke. A restore creates a new committed revision, protects any local draft, and keeps the replaced revision while it is eligible. Attachment versions follow history references until expiry, and purging a note purges its versions and suggestion content.

### Sign-out guard

Before an explicit sign-out, Manor checks pending edits and uploads across open tabs. If any Notes work is unsynced, sign-out cancels automatically, the session and drafts stay intact, and the UI explains the unsynced state; there is no download, discard, or force-sign-out alternative. After everything is committed, a later sign-out clears local account data and ends the session.

The guard is coordinated with local writes so an edit can't slip in between the check and session termination. Authentication expiry or remote revocation can't be prevented by the guard: drafts stay local, replay is blocked, and work resumes only after the same account authenticates. Another account never inherits those drafts or queued writes.

## Files, history, and purge

### Private files

Files live in private Supabase Storage buckets with account-scoped policies and short-lived authorized downloads. The database stores file identity, owner, object path, content type, size, checksum, lifecycle state, and references, and replacements are new immutable objects where history or backup consistency requires it.

The shared [upload policy](../supabase/functions/_shared/fileUploadPolicy.ts), allocation command, finalizer, private bucket, and project Storage configuration enforce a 1 GB ceiling (1,000,000,000 bytes); profile pictures keep their separate 5 MiB limit. Size is validated before a pending Notes attachment is added. Attachments are kept as Blobs in IndexedDB, and SHA-256 is computed in a browser worker over bounded slices instead of copying whole files into memory. Uploads go through the direct Storage host with authenticated, resumable TUS transfers in 6 MiB chunks; resume identity includes the account-owned immutable path and checksum, and refreshed session credentials are attached to each request. The server verifies 32 MiB ranges per invocation, binding each range to the immutable Storage object version and checking exact size and MIME type, with a private checkpoint holding incremental SHA-256 state that only server credentials can read or advance. HTTP `202` reports verified-byte progress and clients continue until the full digest matches and the file becomes ready; checkpoints are removed on completion or purge. Staging verification covered a 1,000,000,000-byte upload with interruption and resume, full checksum validation, and an exact-size download with the same digest. Uncertain completed uploads are verified without resending bytes, and oversized files get an actionable size error rather than a constraint message ([Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)).

A file upload and a Postgres transaction are not one atomic operation: an upload intent is allocated, bytes go to its authorized path, metadata is verified and finalized, and a domain command attaches the file. Pending and failed states stay explicit, a cleanup job removes abandoned uploads, and reference ownership and authorization are checked on both upload and attachment. A file still used by another live record is never deleted.

### Meaningful history

Field-level action events are written in the domain transaction. Structural fields useful for behavior analysis are separate from content-bearing fields that get scrubbed. Secrets, unnecessary full-document snapshots, and autosave keystrokes are not recorded. Source references are stored only where useful, and client-reported provenance is distinguished from trusted server identity. UI availability and retention policy are in the PRD's [action history section](PRD.md#action-history).

### Lifecycle enforcement

The following diagram shows the path from Trash to purge and what the purge leaves behind.

![Trash, purge, and scrubbed history: a deleted record sits in Trash for seven days and can be restored with its relationships; afterwards a content-free tombstone enters the purge ledger, purge waits until a backup has acknowledged the ledger, then removes rows, versions, unreferenced files, search chunks, and receipt payloads while action history keeps structure and loses titles and text.](diagrams/purge.svg)

A deletion timestamp and server-computed purge eligibility implement the PRD's retention rules. Queries and workers exclude trashed content unless they operate on recovery explicitly. Parent and child restore relationships are maintained, and a stale queue can't recreate a deleted record; tombstones hold identity and lifecycle metadata, never content.

A note in Trash can also be deleted permanently on request. The `purge_note` command writes the tombstones for the note and its trashed subpages and runs the same per-object purge routine as the scheduled purge in one transaction, without the seven-day wait or the backup acknowledgement, because the deletion is explicit. Permanent deletion is a user action in the Notes list; the agent catalog offers Trash and restore, not purge.

Purge removes source rows and content-bearing derivatives: document versions, file objects with no surviving references, text and vector indexes, action payloads, command-result payloads, queued job inputs, and stored errors containing source text. Compact command receipts can keep deduplication metadata but never return purged content on retry, and a queued job rechecks the source lifecycle before reading or writing results.

Attributable deleted-source excerpts are removed or redacted from retained generated reviews and syntheses while unrelated user content and structural conclusions are preserved. Because that can be ambiguous for old free-form output, source attribution and targeted purge verification are part of the generated-content design, and erasure is never reported successful while a recoverable copy remains in ordinary application data.

Deletion spans the database and object storage, so purge progress is persisted and incomplete steps retry with an explicit failure status. Reconnecting clients reconcile tombstones and evict stale caches. Operational backups have their own expiry (see [Backups and disaster recovery](#backups-and-disaster-recovery)), and restoration never resurrects purged content.

## Background work and integrations

Supabase Cron schedules the work and Supabase Queues make it durable; workers run short, bounded steps in Edge Functions, checkpoint large batches, and resume through the queue. Queue delivery doesn't make external side effects exactly-once, so workers use idempotency keys, leases, backoff, and explicit terminal failure states ([queues](https://supabase.com/docs/guides/queues), [scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [runtime limits](https://supabase.com/docs/guides/functions/limits)). The following diagram shows each schedule and what it touches.

![Background work: cron drives the integration worker every minute (Google Calendar read-only, X bookmarks every ten minutes), the embedding worker every minute (OpenAI), jobs ingest every six hours (SimplifyJobs), and hourly maintenance; the weekly review is scheduled by the ChatGPT host and saved through MCP.](diagrams/background.svg)

The following table records which work involves a model and which doesn't.

| Work | Execution and model boundary |
|---|---|
| X bookmarks | Server-side OAuth tokens, incremental ingestion and deduplication, linked-content extraction; no generation-model pass |
| GitHub jobs catalog | Structured SimplifyJobs data with source validators and cursors; deterministic filtering and deduplication |
| Google Calendar | Read-only backend synchronization for Home; server-stored refresh tokens and web OAuth callbacks |
| Course calendar feed | The saved Canvas feed link (a credential kept in `manor_private`) is fetched and parsed by the `course-feed` function only when Settings or the agent asks; no schedule, no storage, no model |
| Supplied captures | Codex supplies screenshot or media and processed content; Manor validates and stores it without a second normalization-model call |
| Embeddings | OpenAI embedding API with the retained server-side key; only changed, eligible content is queued |
| Weekly reviews | Hosted ChatGPT Work schedule reads inputs and saves generated content through remote MCP; no Manor-hosted generation-model call |
| Maintenance | Recurrence generation, streak reconciliation, cleanup, purge, and backups; no language model |

Calendar and X connections use `https://<project-ref>.supabase.co/functions/v1/integration-callback` in each environment, separately from the Supabase Auth sign-in callback; both the staging and production URLs are registered on the Google Web client and the X OAuth app. X is configured as a confidential web app, matching its server-side token exchange. A connection returns through the build's URL scheme (`manor://settings` or `manor-staging://settings`), which the callback derives from the environment's `MANOR_DESKTOP_SCHEME` setting; the functions accept only the app's webview origin `tauri://localhost`, which is `MANOR_ORIGIN` in both environments.

Browser reads of connected accounts, calendars, events, and X connection state go straight to the owner-scoped tables and the small `manor_x_status` RPC; the `integrations` function serves only OAuth, visibility, disconnect, and manual X sync. The minute worker claims up to sixteen due accounts per tick and processes one event page for every connected calendar; a successful Google run reschedules itself for the next minute boundary, and provider failures back off exponentially. The owner-wide twelve-calendar cap is serialized in the database: OAuth stores a new Google account and its discovered calendars atomically and rejects connections that would exceed the cap, while calendars discovered later beyond the cap are skipped and reported without interrupting the stored calendars. Home reads synced events once a minute.

Codex-owned Gmail, Slack, and similar connections are outside this backend: Manor accepts source-independent domain changes and optional provenance, not connector-specific mutations, and screenshots originate from Codex or user-supplied media. Provider quotas, OAuth requirements, and X API charges are separate from model usage.

For reviews, the first input read freezes an account-owned snapshot, and a save requires that snapshot ID, period, time zone, and watermark. Repeated reads return the same capture, and a source purge invalidates it rather than silently rebuilding it. Same-period, same-content saves are idempotent even across distinct command IDs. The window is [previous Sunday 22:00, current Sunday 22:00) in the saved IANA time zone, with each boundary resolved to an instant, so a DST-crossing week is not assumed to be 168 hours; a delayed or retried run keeps the scheduled cutoff. Timestamped history uses the half-open interval, and date-keyed habit and mood records use the seven calendar labels Monday through Sunday so the ending Sunday isn't counted twice. Missing values stay unknown and Resting stays explicit. Snapshots record their first capture time and disclose that daily records can change after a delayed cutoff, and server-derived completion event counts are distinct from unique completed-task counts. Staging tests cover 167-hour and 169-hour DST windows, repeated reads after source edits, idempotent saves, cross-account denial, and purge invalidation.

Structured, source-attributed review content is validated before saving, with available execution provenance and the input watermark recorded and no invented host model or token metadata. Retries never duplicate reviews or mutate tasks. A missed or failed scheduled run stays visible with an authorized retry for the same period. Verifying OAuth access and host write permissions with the laptop and Manor tab closed is part of release acceptance; scheduling alone doesn't guarantee unattended writes, and no host transcripts, automatic ChatGPT Health access, or silent API-generation fallback are assumed.

The OpenAI key is used only for separately billed embeddings; weekly-review reasoning consumes the ChatGPT host's allowance. Embedding and index migrations record the model version rather than mixing incompatible vectors.

## Backups and disaster recovery

Daily database backups and daily file backups with seven-day retention give an approximately one-day recovery-point target, contingent on successful runs; actual backup age and failed jobs are monitored. This is not zero data loss or instant recovery, and no point-in-time recovery add-on is needed for the selected baseline. Supabase Pro supplies the daily database backups; they exclude Storage object contents, and restoring a live database involves downtime, so uploaded objects are backed up separately ([Supabase backups](https://supabase.com/docs/guides/platform/backups)). The following diagram shows the recovery points and the isolated restore.

![Backups and isolated restore: production Postgres has a managed daily backup and a purge ledger that is acknowledged before purge; storage objects are copied by restic and rclone into an S3-compatible bucket; a recovery project restores the managed backup, applies tombstones newer than it, copies only files whose checksum matches a surviving reference, and is verified with workers and users off.](diagrams/recovery.svg)

Each file manifest includes immutable object versions and records object IDs, paths, checksums, ownership metadata, and the database watermark needed to reconcile references. Every retained recovery point keeps the file versions it needs; a mirror is never overwritten and source deletions are not propagated immediately into all copies. Backups are encrypted, and restore credentials are separate from app credentials.

The [recovery tooling](../tools/recovery/README.md) uses pinned restic for encrypted snapshots and retention, rclone for transfer, and a daily GitHub Actions workflow template. An independent managed backup store and its credentials have to exist before the schedule is activated. Database and file recovery points are coordinated: a row is not backed up successfully if its referenced object can't be restored. Snapshots and unreferenced backup objects expire on the retention schedule, with the actual deletion behavior verified.

A restore is rehearsed in an isolated recovery environment with ingestion, outbound messages, and generation jobs off; record counts, ownership, relationships, checksums, and representative reads are verified. Lifecycle tombstones newer than the restored snapshot are applied before recovered data is served, and the content-free deletion ledger is kept independently recoverable from the snapshot being restored. The prepare, checkpoint, and acknowledge protocol prevents physical purge until a verified independent ledger snapshot exists, and restoration applies the latest ledger before file reconciliation, with recurring occurrence identities preventing rematerialization.

Operational backups can contain subsequently deleted data until their retention expires; they are restricted recovery material, not a second user-visible archive or a tool-accessible source. A failed restore or missing daily backup is reported as a gap rather than an older recovery point presented as current.

## Migration and verification

The Electron-era data was migrated in place with a read-only cutover window. The steps were:

1. Inventory local and cloud module data, ownership, file locations, preferences, and legacy history, snapshotting sources without exposing private contents.
2. Reconcile duplicates and divergent versions in staging, preserving both sides of any unresolved conflict rather than letting last-write-wins discard work, and preserving source and date provenance, with the historical `alfred` origin mapped to `codex` only through an explicit, reviewed transformation.
3. Implement the schema, shared commands, drafts, files, jobs, and the remote MCP adapter, and verify the target behavior before importing into production.
4. Confirm that previously deployed writers and scheduled functions being replaced are off (removing their source doesn't undeploy them), then import and reconcile records and files and validate identities, relationships, hashes, and representative workflows.
5. Enable web writes only after the checks pass, keep rollback snapshots protected through the agreed recovery period, and remove retired deployment configuration and secrets after reconciliation.

Verification includes real integrated flows for account isolation, direct-signup bypass, Google identity verification, unauthorized direct writes, retry after an uncertain commit, concurrent edits, route-independent tools, immediate UI refresh, Notes offline reload and sign-out cancellation, file finalization, parent and child Trash restoration, purge across derivatives, scheduled execution without the browser, and a database-plus-files restore. Operational logs are structured with command and job IDs and timings, with secrets and content redacted; operational diagnostics are distinct from meaningful action history.

## Remaining technical work

The architecture choices are settled. The following items need configuration or verification work, not another design round:

- End-to-end OAuth and hosted-client verification against the implemented schema and shared catalog, with measured latency budgets.
- Independent file backup destination credentials, scheduler activation, and a demonstrated remote database-plus-files restore.
- Hosted schedule and write-permission verification before reviews are enabled.
- Apple code signing and notarization, so a build installs on a Mac other than the one that built it without Gatekeeper's warning.

Remaining product scope is in the PRD's [remaining product detail](PRD.md#remaining-product-detail).
