# Manor Architecture

_Last updated: 2026-09-13_

This document owns the technical design of the web migration. [PRD.md](PRD.md) owns product behavior, authority, business rules, and delivery scope; [DESIGN.md](DESIGN.md) owns the visual baseline. Refer to those rules rather than restating them here. Physical schemas and tool contracts live in migrations and typed source.

## 1. Status and Scope

**Production backend and website are deployed; release acceptance has remaining items.** The production Supabase project carries all 47 migrations applied over the preserved Electron-era data (2026-09-12), the ten web functions, the four `manor-*` schedules, Google-only Auth with both hooks and the OAuth server, and the migrated resume and capture files; the legacy functions and schedules are removed. `mymanor.vercel.app` serves the production build against it. `app/` now has a Vite web entry point, Supabase view adapters, transactional commands, account-scoped query refresh, and the redesigned light/dark interface. The Notes editor includes native columns/tabs, durable browser drafts, attachment queues, conflicts, versions, and suggestions. A real private-file upload, retry, and byte-for-byte download flow has passed in staging.

The staging remote MCP endpoint has passed synthetic OAuth dynamic registration, PKCE authorization-code exchange, resource-audience validation, read/write tool access, idempotent Notes import, find/export/duplication, relationships, change-feed catch-up, atomic Trash batches, write-scope downgrade, token refresh, and immediate revocation. Google-only signup gating and the OAuth token hooks are enabled and their persisted configuration is verified, and interactive Google sign-in completes on the hosted staging site. Google Calendar and X accounts are connected in staging: the calendar job resyncs at each minute boundary and the X job completes without errors. Integration and jobs workers use dedicated worker authentication. Attachment tools enforce account ownership and live OAuth grants; a synthetic signed upload, finalization, and exact-byte download passed. Jobs ingestion populated the staging catalog. Embedding activation and actual synthetic OpenAI indexing/search checks passed, including stale-result rejection, unchanged-text reuse, and Trash exclusion (§8). Integration, jobs, embeddings, and maintenance schedules are active in staging. Staging browser access is restricted to the canonical staging website; localhost origins and sign-in return URLs are disabled.

Database daily backup metadata is verified. File recovery tooling has local encrypted snapshot/restore and staging purge-checkpoint verification; independent remote storage credentials and a complete remote restore rehearsal remain outstanding (§9).

Native agent-host verification against the production endpoint, reconnecting the X account whose legacy token production rejects, and remote database-plus-files recovery are release acceptance work. Migration bookkeeping is reconciled in both projects: 47 unique versions are recorded and all 34 web migration sources match their stored hashes; the same 34 applied cleanly in production over live data. A replay from an empty database remains unverified. The exact inventory is in [current-status.json](../tools/recovery/current-status.json). Existing user data and unrelated uncommitted work remain protected. The presence of an implementation or staging deployment does not establish that these checks have passed.

React, TypeScript, Vite, React Router, and BlockNote remain the application stack. Supabase adapters, TanStack Query server state, and IndexedDB draft protection sit at the web boundary. View-service interfaces are UI dependencies; migrations and the shared tool catalog define transactional contracts. A future iOS client can consume the same backend operations directly.

The main app is hosted for testing at [mymanor-staging.vercel.app](https://mymanor-staging.vercel.app), in a dedicated Vercel project connected only to staging Supabase. SPA deep links, compiled assets, the service worker, and manifest passed HTTP checks with correct content types. The canonical staging alias serves the sign-in shell publicly; the immutable deployment URL retains Vercel authentication under the existing protection setting. The approved staging origin is configured for Auth return URLs and browser access. Testing uses the hosted staging site; localhost is not authorized. Google sign-in completes on the hosted staging site. The `mymanor` project serves the production build at `mymanor.vercel.app` with production Supabase connection values.

## 2. Runtime and Deployment Boundaries

![Runtime and privacy boundaries](diagrams/runtime.svg)

[Edit the Excalidraw scene](diagrams/runtime.excalidraw).

### Web hosting

Use Vercel Pro to serve the Vite application. The production address is `mymanor.vercel.app`. The separate `mymanor-staging` project serves the test website. Vercel labels that project’s deployment target production, but its configuration and data are staging only. Google OAuth configuration alone does not reserve the address. Neither application needs server rendering for the selected scope. Keep browser navigation/deep-link rewrites compatible with the client router.

Supabase hosts authoritative data, authentication, private files, realtime changes, and backend jobs. Avoid introducing a second general-purpose API server or proxying ordinary database reads through Vercel. External credentials and privileged operations belong in server-side functions.

### Environments and releases

Staging and production use separate Supabase projects: independent accounts, database rows, storage, secrets, integration tokens, and job queues. Vercel previews target staging, never production. Use synthetic staging data; staging jobs must not consume production integration accounts. Local development has no authorized backend: it covers unauthenticated UI work, typecheck, and unit tests only. Signed-in and end-to-end verification runs against the hosted staging site, whose Auth return URLs and browser origins exclude localhost (§1).

Use environment-scoped configuration and stable staging callback URLs for OAuth. Only publishable connection details are included in frontend bundles. Vercel distinguishes deployment environments, but resource isolation must be configured explicitly. [Vercel environments](https://vercel.com/docs/deployments/environments)

Build production with production configuration. Do not promote a static staging bundle with baked-in staging settings to the production URL. Rehearse migrations in staging, then apply the approved production migration and deploy the compatible client. Source code and database changes have separate rollback implications; reverting a frontend deployment does not undo database writes.

### Code organization

Keep one repository. Separate application UI, pure domain logic/contracts, Supabase adapters, remote MCP registration, and Notes persistence. Backend functions and migrations remain under `supabase/`. Share types and validation where runtimes permit; browser modules must not import Node filesystem or Electron code. Keep exact folder moves in implementation changes rather than maintaining a second directory inventory here.

## 3. Authentication and Authorization

Use Supabase Auth with Google as the only account sign-in provider. Disable email/password, magic-link, phone, and anonymous account entry paths; do not implement Manor password creation/reset or separate verification emails. No SMTP provider or AgentMail credential is required for this release. Google supplies verified identity; require the supported provider-verified email identity before admitting a new account. Register a Google Web application OAuth client and each environment's exact Supabase callback, then allowlist the corresponding Manor return URLs. Keep the Google client secret server-side. Calendar authorization remains separate from login. [Google OAuth setup](https://supabase.com/docs/guides/auth/social-login/auth-google)

The PRD signup gate must run before account creation. Validate the shared gate password on the server, using rate limits and a stored secret/hash; never put the password in user metadata, URLs, or logs. A short-lived, single-use server-recorded signup grant binds successful gate validation to the intended Google email; the eventual verified OAuth identity must match it. Use the before-user-created hook to reject account creation without a valid grant, including direct Auth API and OAuth requests. Validate and consume the grant server-side rather than trusting client-editable metadata. Test the gate with first Google login, returning users, account switching, mismatched Google emails, replay, and interrupted OAuth. A UI-only gate after Supabase account creation does not satisfy the product requirement. [Before-user-created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)

For ordinary data:

- Derive account identity from verified authentication, not a supplied owner ID. Use explicit grants and owner-scoped RLS on exposed tables, written as `(select auth.uid())` so the check runs once per statement, with an index on every policy column; enforce same-owner relationships with constraints as well as application validation.
- Authenticate reads, aggregate queries, storage requests, and commands. Views must preserve caller authorization; a convenience view must not accidentally bypass RLS.
- Direct table writes must not bypass command validation, revisions, deduplication, or history. Prefer invoker privileges where sufficient. Privileged functions require narrow execution grants, fixed search paths, explicit ownership checks, and a least-privilege owner; never expose a general privileged database endpoint. [Database function security](https://supabase.com/docs/guides/database/functions)
- Integration credentials, queue controls, signup grants, and infrastructure records are not client-readable. Keep service-role keys exclusively server-side. Backend workers receive only the data and capabilities needed for their job.
- Remote MCP uses a scoped, revocable OAuth authorization for the account; Google client credentials are not MCP credentials. The adapter enforces the shared operation boundary. There is no independent agent superuser. Caller-provided provenance is context, not proof of authorization or a trustworthy actor identity.

Clear authenticated query caches and subscriptions after a completed sign-out. The pending-draft guard runs first (§6). Session expiry is different: preserve local drafts, stop authenticated operations, and require the same account to reauthenticate before replaying them.

## 4. Data Model and Command Transactions

### Relational ownership

Keep domain records relational, with JSON reserved for structured document content and genuinely flexible payloads. Preserve existing stable IDs during migration; do not renumber user data merely to standardize identifier format. New IDs must be collision-resistant. Domain constraints belong in the database where they affect persisted correctness.

| Domain | Technical representation |
|---|---|
| Accounts | Profile, saved timezone, account preferences; authentication identity supplied by Supabase |
| Tasks | Tasks, context references, saved views, recurrence series, occurrence identities, independent scratch blocks |
| Habits | Habit definitions, lifecycle changes, dated entries, freeze intent and derived streak/pool state |
| Mood/focus | Unique account/date record with independent ratings and one versioned synthesis |
| LeetCode | Stable curriculum problems, dated attempts preserving source text, separate mistakes notes |
| Jobs | Shared source catalog; owner-specific roles, stage events, resume references and versions |
| Notes | Folder/page relationships; lossless BlockNote JSON with stable block IDs; page revisions and attachment references |
| Knowledge | Source entries, supplied capture content, file references, extracted search text, versioned embedding chunks |
| Reviews | Account/review-period record, input watermark, generation state, generated content, model metadata |
| Infrastructure | Command receipts, meaningful action events, jobs, file lifecycle records, purge tombstones |

This is a logical inventory, not an additional physical schema. SQL migrations will define actual tables, keys, indexes, and allowed transitions. Preserve module rules by reference to PRD §§6–7.

### Shared command boundary

UI actions and remote MCP calls invoke the same named operations. TypeScript contracts and runtime validation provide consistent inputs/results; server-side enforcement remains authoritative. Database-only mutations use transactional RPCs. External operations use Edge Functions and durable jobs, returning an accepted job/file state when completion is asynchronous.

![Command transaction and uncertain-response handling](diagrams/commands.svg)

[Edit the Excalidraw scene](diagrams/commands.excalidraw).

History and receipts serve different purposes: history explains meaningful changes; receipts resolve uncertain delivery. Serialize competing writes with version checks and appropriate database locking. Conflict responses must carry enough current state for resolution without silently overwriting newer data.

Use explicit atomic batches for related mutations. For independently processed bulk items, return each item's result and stable command ID; never disguise partial success as an atomic outcome. Set documented batch and response bounds during implementation.

### Dates and recurrence

Store instants as timezone-aware timestamps and date-keyed logs as dates. Compute business dates from the account timezone specified in the PRD, using the same clock rules in browser hints and server validation. Unique occurrence keys combine the series identity with its scheduled occurrence identity. Persist exceptions and completed/skipped outcomes separately from the series definition.

Historical mood/focus rating corrections use a dedicated account-authenticated command with date and revision checks, preserving synthesis fields and recording ordinary action history. The command rejects OAuth agent clients and is not published in the MCP catalog; the History editor owns this exception to ordinary daily capture bounds.

A scheduled generator materializes occurrences ahead of time and catches up after interrupted runs. Its watermark and unique constraints prevent duplicate occurrences. Series edits implement PRD §7.3 with occurrence exceptions or an effective future-series boundary; they must not rewrite historical outcomes. Streak reconciliation derives state from source entries and intent, rather than maintaining a competing mutable truth.

## 5. Queries, Realtime, and MCP

### Reads and cache consistency

TanStack Query owns browser server state. Query keys include account identity and filter/page parameters. Use server-side filtering, deterministic ordering, cursor pagination for growing collections, and bounded aggregate queries. Do not load entire modules on every mutation or invalidate the entire application for a local change.

At boot the shell starts the account load, the App chunk, the current route's chunk, and the route's first reads together, so a warm page has its data in flight before React mounts it. Apply returned committed records to the initiating browser's cache immediately. Realtime events carry account-authorized change notifications to other tabs/views, which invalidate or refetch relevant queries. Reconnect and window-focus reconciliation recover missed notifications; Realtime is not a durable history of every event. Ignore stale versions arriving after newer ones. Protect drafts separately from cached server records (§6).

Measure server execution, network round trip, and commit-to-render delay independently. Tool success must mean persisted success; an optimistic visual state, if used, must remain distinguishable from confirmed saving. Final latency thresholds will be set against representative staging data and the actual browser host, not invented in this document.

### Remote MCP adapter

Tool contracts must cover the capability scope in PRD §5. Use explicit schemas, stable IDs, record versions, bounded results, searchable filters, and structured errors. Include targeted note/block operations and useful domain batches. Return job IDs/status for asynchronous work, rather than waiting through unrelated processing or falsely reporting completion.

Tool mutation authority and confirmation policy belong in the PRD; the adapter must not add a duplicate approval workflow. Page content and imported documents are untrusted data, not executable instructions or authority grants.

Expose the shared domain operations through an authenticated HTTPS MCP endpoint, using a maintained MCP SDK and OAuth 2.1 resource/authorization discovery. Supabase Auth's OAuth-server capability is the preferred starting point; verify current MCP resource, audience, scope, PKCE, token refresh/revocation, and ChatGPT client-registration compatibility before enabling it. Resource access must remain account-scoped even when a caller supplies another account's record IDs. Never hand an agent a Supabase service-role credential. [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth)

Remote calls operate on committed data and return revisions and receipts through the same command boundary. They have no implicit access to open tabs, selections, unsynced drafts, or presentation controls. Realtime/refetch updates open clients without overwriting drafts.

### Current tool coverage and host connection

The [shared catalog](../supabase/functions/_shared/toolCatalog.ts) contains 112 executable operations (46 reads and 66 writes). Remote MCP exposes their individual names and restricts read-only grants to reads. Repeated constraints use standard JSON Schema references and shared constraints; per-operation server validation is authoritative. There is no live-browser transport: agents have no access to the open tab, selection, unsynced drafts, or presentation.

Workspace/calendar/habit retrieval, named metrics, command status, a content-free change cursor, current integration-job status/retry, record links, safe preferences, saved task views, precise Notes duplication/media operations, and atomic cross-module lifecycle batches are implemented. Some accepted names share operations: `update_tasks` completes/reschedules tasks, `set_habit_status` manages habit lifecycle, and `update_applications` changes stages/resumes. `query_weekly_reviews` accepts an ID for a single review.

Remaining capability limits are explicit: agent import/export supports lossless `block_json`, not Markdown; automatic bookmark-preview fetching needs a controlled egress/extraction boundary before arbitrary URLs can be fetched safely. Job status covers current Google/X synchronization jobs, not a general historical run archive. These limits also appear in tool descriptions or workspace restrictions.

Notes lifecycle guards inspect descendants and nested batch targets.

Five staging rollback suites cover workspace queries, Notes tools and attachment retention, relationship ownership/purge, weekly snapshots, and atomic lifecycle operations. Synthetic Remote MCP tests also verify discovery, schema routing, successful writes, retry receipts, scope enforcement, refresh, and revocation. These checks do not prove every hosted-client workflow.

The personal Manor plugin is installed from `~/plugins/manor` through the personal marketplace. It contains the staging OAuth endpoint, branding, and Manor/weekly-review skills, with no embedded credentials. Hosted ChatGPT Work needs its own registered connection and Manor OAuth authorization; local installation does not establish hosted or mobile availability. The staging endpoint is `https://cysdooljdslgvqrahymm.supabase.co/functions/v1/manor-mcp`; the production endpoint is `https://pxdxqueevzttpmxjsqes.supabase.co/functions/v1/manor-mcp`. The documented hosted registration flow uses ChatGPT Plugins; an equivalent desktop registration control has not been verified. The registered hosted connection ID, hosted skill mapping, and unattended review execution remain pending. [Direct MCP connection and testing](https://developers.openai.com/plugins/deploy/connect-chatgpt), [plugin packaging](https://developers.openai.com/plugins/build/plugins).

After connecting the hosted account, test a manual read and authorized write, then the Sunday schedule with Manor and the laptop closed. Cloud Work supports continuing a chat from mobile; connection availability and permissions must be checked in that chat. [Hosted MCP](https://learn.chatgpt.com/docs/extend/mcp), [cloud and mobile Work](https://learn.chatgpt.com/docs/get-started-with-work#choose-local-or-cloud-work), [scheduled connected tools](https://learn.chatgpt.com/docs/automations#manage-scheduled-tasks-on-the-web).

### Accepted tool surface

The capability catalog and workflow approach below are accepted. Tools must provide deep operations with minimal intermediate calls: use bounded domain batches, return committed state directly, and avoid mandatory discovery, preview, or confirmation round trips when targets and intent are already clear. The accepted target below is broader than the currently registered tools; the implementation gaps are listed above. Exact names/schema details may be refined without reducing coverage. Maintain explicit, schema-validated domain tools and a few useful workflow commands. The operation layer owns behavior; remote MCP adapts it to its hosts. Do not make the agent navigate to a module to unlock its tools, or expose a generic SQL/script executor.

| Capability | Accepted capability catalog | Contract focus |
|---|---|---|
| Workspace context | `get_workspace_context`, `get_day_overview` | Saved timezone/local date, recently opened objects, capability version, and connectivity. Return compact context; fetch content only when needed. |
| Cross-module retrieval | `search`, `get_related_records` | Text/semantic search with module/date filters, source IDs, snippets, revisions and cursors. Relationships are explicit links or labeled retrieval matches, not invented associations. |
| Tasks and contexts | `query_tasks`, `create_tasks`, `update_tasks`, `complete_tasks`, `reschedule_tasks`, `skip_task_occurrence`, `list_contexts`, `create_context`, `update_context`, `remove_context`, `list_task_views`, `save_task_view` | Typed fields, bounded batches, exact occurrence identities and version checks. Use explicit this-occurrence or this-and-future scope, preserving history. |
| Home scheduling | `query_calendar_events`, `query_scratch_blocks`, `create_scratch_blocks`, `update_scratch_blocks`, `delete_scratch_blocks` | Calendar reads are distinct from Manor-only scheduling writes. Exact instants/durations plus account-local dates; never an implicit provider write. |
| Habits and streaks | `query_habits`, `query_habit_history`, `create_habit`, `update_habit`, `pause_habit`, `resume_habit`, `retire_habit`, `reactivate_habit`, `log_habits`, `clear_habit_entries`, `spend_freeze`, `release_freeze`, `get_streak_status` | Explicit dated logs and lifecycle commands; derived streak/pool outcomes returned with the write. No permanent habit deletion or bypass of backfill rules. |
| Mood, focus, debrief | `query_daily_records`, `log_daily_ratings`, `update_daily_synthesis`, `commit_debrief` | `commit_debrief` atomically applies the revised synthesis and any explicitly supplied ratings for one allowed date. No mandatory transcript or per-session summary. Preserve the existing synthesis through revision-aware editing. |
| Notes retrieval and organization | `query_notes`, `read_note`, `read_note_blocks`, `find_in_note`, `create_note`, `update_note_metadata`, `move_note`, `duplicate_note`, `list_note_folders`, `create_note_folder`, `update_note_folder`, `move_note_folder`, `remove_empty_note_folder` | Outline/selected sections/full reads are explicit bounded projections. Note hierarchy remains preserved; folder removal does not imply deletion of its contents. |
| Notes content | `edit_note_blocks`, `move_note_blocks`, `duplicate_note_blocks`, `propose_note_edits`, `query_note_suggestions`, `resolve_note_suggestions`, `list_note_versions`, `read_note_version`, `restore_note_version`, `import_note`, `export_note` | Typed edits for insertion/removal, anchored text changes, formatting, conversion, list/toggle/check state, table rows/cells, and supported column and tab containers. Suggestions retain anchored changes and base revisions until resolved; version restoration creates a new revision. Cross-note movement is one operation with both base revisions. Imports/exports declare unsupported conversions. |
| Files and media | `begin_file_upload`, `finalize_file_upload`, `get_file_status`, `get_file_access`, `attach_note_media`, `update_note_media`, `replace_note_media`, `refresh_bookmark_preview` | Durable file IDs, explicit media state, and precise caption/alt/crop/layout fields. File bytes use an authorized upload channel; a tool argument containing a local filesystem path does not give the website file access. |
| Job applications and resumes | `query_job_catalog`, `query_applications`, `add_applications`, `update_applications`, `change_application_stage`, `get_application_history`, `list_resume_versions`, `create_resume_version`, `set_application_resume` | Explicit pipeline admission, stage corrections, owned file references and resume versions. Adding from the catalog accepts stable listing IDs; manual roles use the same domain validation. |
| LeetCode | `query_curriculum`, `query_attempts`, `log_attempt`, `update_attempt`, `delete_attempt`, `query_mistakes`, `create_mistake`, `update_mistake`, `delete_mistake` | Preserve exact solution text and separate each attempt from its stable problem. Return updated progress, intensity and streak implications. |
| Knowledge and captures | `query_knowledge`, `read_knowledge`, `create_capture`, `update_capture`, `link_records`, `unlink_records` | Source-independent supplied content, stable attachment IDs, provenance and extraction/index readiness. Linking does not silently copy content across lifecycle boundaries. |
| Analysis and reviews | `get_metrics`, `query_history`, `get_weekly_review_inputs`, `save_weekly_review`, `read_weekly_review`, `list_weekly_reviews` | Named metrics and bounded dimensions/date ranges, with sample/coverage counts and missing-value semantics. Return revision-marked review inputs and accept an idempotent, source-attributed review write for the exact period. |
| Recovery and operation status | `list_trash`, `trash_records`, `restore_records`, `archive_records`, `unarchive_records`, `get_operation_status`, `get_changes_since`, `get_background_run`, `retry_background_run` | Module-specific lifecycle allowlists; only eligible account jobs may be retried. A compact durable revision cursor supports catch-up independently of transient Realtime and narrative history. Cursor expiry requires explicit resynchronization. |
| Preferences and status | `get_preferences`, `update_preferences`, `get_integration_status` | Safe appearance/view preferences are separate from timezone changes and credential/account management. No secrets returned. |

`get_workspace_context` also reports the implemented capability/schema version and current restrictions, so optional features such as tabs or suggestions are never advertised before they work. Publish concise descriptions through the host's normal discovery mechanism; do not introduce a second natural-language command router. Unsupported operations return specific errors rather than being silently approximated.

### Workflow composition and response semantics

Use domain batches to reduce round trips: creating several tasks, rescheduling selected occurrences, or applying a group of note edits should take one bounded call. Batch contracts state whether they are atomic. Database-only workflow commands can be atomic; a file upload plus a database write cannot pretend to have the same guarantee (§7). Validate the complete atomic batch before applying it. Do not add a mandatory preview/confirmation call to every action.

Mutation inputs carry an idempotency identity, stable targets, expected revisions where needed, typed changes, and optional source references. The adapter may generate and retain the identity for the logical request. Retry after an uncertain response reuses it. Receipts return the original outcome while identifying its committed revision; newer cache state must not regress to that older receipt. Aborting a browser request does not establish that its server mutation was rolled back: use `get_operation_status` to resolve uncertainty.

Return an explicit outcome (`committed`, `accepted`, `conflict`, or failure), affected IDs, committed versions and a bounded projection of changed data. Asynchronous responses additionally carry a run/upload ID and readiness state. Include a useful object link where applicable. A committed result remains committed if the originating view disappears before rendering; do not report that the user saw a change merely because the server saved it.

Apply committed results directly to the relevant query cache and active editor. Preserve caret, selection, scroll position and unrelated unsaved work. A local draft version and its cloud base version must be distinguishable in reads and selections. Changes confined to different blocks may merge; overlapping edits return a resolvable conflict (§6). Never replace a full document with generated Markdown to execute an anchored text edit.

Bulk targets must be bounded and unambiguous. Reads return IDs and versions so a later write cannot accidentally affect additional records that began matching a filter in the meantime. Named aggregate queries expose useful calculations without arbitrary SQL; include timezone, period, data coverage and definitions so missing days are not counted as zero. Reads and navigation do not enter meaningful action history.

Example compositions:

- **Email to tasks:** Codex reads its email integration, finds relevant existing tasks, then submits a task batch with optional source references. Manor does not expose an email-specific task command.
- **Voice debrief:** read the day's combined context, then `commit_debrief` with the synthesis update and explicitly stated ratings. Habit/task changes from the same conversation use their respective batches; no browser transcript is stored.
- **Edit this paragraph and add a screenshot:** locate the target blocks with `find_in_note` or `read_note_blocks` (revision-bound), finalize the supplied asset through the supported upload path, then apply an anchored content edit and media insertion. Return block IDs so the result can be cited.
- **Explain a pattern:** query dated metrics plus meaningful history and source records; Codex performs the interpretation. No second backend model call is required for that conversation.

The MCP transport does not supply Manor's persistence, transactions, retry receipts, or background scheduler; those live in the command boundary. These tools never expose unrestricted infrastructure controls or Codex conversation/notification management.

### Search and embeddings

Use Postgres text search for exact/content retrieval and pgvector for semantic retrieval where needed. Search results include source IDs, revision identifiers, and useful snippets; fetch full records on demand. Index only authorized, live content.

Embedding jobs carry a source ID, content revision/hash, and model/index version. Discard stale results if the source changed or entered Trash. Repeated ingestion of unchanged content must not repeat embedding work. Store deterministic extraction separately from model output. Search indexes are derived data and must be rebuildable from retained source records.

Staging automatically indexes Notes and Knowledge with separately billed OpenAI `text-embedding-3-small` embeddings at 1,536 dimensions. The index version is `text-embedding-3-small:1536:v1`. The worker uses `cl100k_base` tokenization, lossless Unicode boundaries, at most eight 1,500-token chunks per run, and a durable source offset. Metadata-only changes advance indexed revisions without another embedding request. Trash removes derived chunks; restoration queues fresh indexing. Provider-reported token usage is recorded per request in a private table. The scoped-secret Cron worker and authenticated semantic-search endpoint are active in staging; production activation is separate. Synthetic staging checks cover semantic retrieval, stale commits, unchanged content, Trash, and restoration.

## 6. Notes Drafts and Editing

Retain a versioned BlockNote-compatible document as the lossless source format. Full Notes parity may require extending the retained schema and replacing custom container implementations; the evidence is in [REDESIGN-REPORT.md](REDESIGN-REPORT.md#notion). Every editable nested block, including content in columns and tabs, must have a stable address and consistent schema. Opaque serialized subdocuments must not make nested content invisible to search, selection, undo, or agent operations. Verify the chosen container model and round-trip fidelity before migration. Markdown remains a lossy import/export representation; the supported editing features belong in PRD §7.7. Do not replace a document with model-generated Markdown to implement a small note edit.

Use IndexedDB for account-scoped drafts, base revisions, ordered pending mutations, and pending attachment bytes. A maintained wrapper such as Dexie is an implementation choice, not a new synchronization authority. Persist draft changes locally before claiming local protection, and separately indicate cloud commit. Quota or persistence failures must be visible; a browser cache is not a backup. Account-scoped cached profile and Notes state support reopening after an explicitly classified network transport failure; authentication, authorization, and other server errors propagate instead of being treated as offline. A production-build reload with network access blocked passed, preserving the rich-text paragraph and showing the offline banner even when the browser’s connectivity flag was inaccurate.

The Workbox service worker precaches only the app shell and page chunks (about 4 MB); syntax grammars, KaTeX fonts, and legacy font formats are cached on first use. Hashed assets are served with a one-year immutable cache header, so warm loads read them from cache without revalidation. It never caches API responses. The app owns registration and checks for releases when a visible tab opens, regains focus or connectivity, and every minute while visible. A waiting release shows an explicit Reload action; activation reloads only the tab that requested it. Other tabs retain their open work and offer their own Reload action. Open dialogs and Notes edits not yet protected in IndexedDB block the update action. The `/auth/update` entry bypasses the worker's navigation cache to bootstrap clients whose older shell lacks update controls; it returns to Home without clearing account or draft storage.

Only one browser writer may replay a given document queue at a time, and within that tab the saves for one note run strictly in order so each replay reads the base revision committed by the save before it. Coordinate tabs and preserve idempotency across reloads. Compare base, local, and server revisions. Merge demonstrably non-overlapping block changes; return a real conflict for overlapping text, deletion, movement, or hierarchy edits that cannot be safely combined. Agent operations use stable block IDs and expected versions. Never refetch over unsaved keystrokes.

After a cloud-save failure, Notes navigation verifies that the exact current draft is committed in IndexedDB before allowing another note or scope to open. The failed draft and attachment bytes remain protected, with a notice linking back to the note for retry. Actions requiring cloud consistency retain their save guard; failed local protection still blocks leaving the note.

### Suggestions and document versions

Persist requested suggestions separately from accepted document content, with stable block/text anchors, proposed operations, base revision, and resolution state. Ordinary direct editing remains the default. Accept/reject uses atomic domain commands and revision checks; stale overlapping suggestions surface a conflict instead of applying to unrelated text. Pending suggestions survive reload, navigation, and sign-out.

Retain meaningful document versions for the seven-day Notes history UI, rather than snapshotting every keystroke. A restore makes a new committed revision, protects any local draft, and retains the replaced revision while eligible. Attachment versions follow history references until expiry. Purge versions and suggestion content with the source note.

### Sign-out guard

Before explicit sign-out, check pending edits and uploads across open Manor tabs. If any Notes work is unsynced, **cancel sign-out automatically and keep the session and drafts intact**. Explain the unsynced state in the UI. This flow has no download, discard, or force-sign-out alternative. Once everything is committed, a later sign-out can clear local account data and end the session.

Coordinate the guard with local writes to avoid an edit being created between the check and session termination. Authentication expiry or remote revocation cannot be prevented by this guard: retain drafts locally, block replay, and resume only after the same account authenticates. Another account must never inherit those drafts or their queued writes.

## 7. Files, History, and Purge

### Private files

Use private Supabase Storage buckets with account-scoped policies and short-lived authorized downloads. Store file identity, owner, object path, content type, size, checksum, lifecycle state, and references in the database. Treat replacements as new immutable objects where history/backup consistency requires it.

The shared [upload policy](../supabase/functions/_shared/fileUploadPolicy.ts), allocation command, finalizer, private bucket, and project Storage configuration enforce a 1 GB ceiling (1,000,000,000 bytes); profile pictures retain their separate 5 MiB limit. Validate size before adding a pending Notes attachment. Keep attachments as Blobs in IndexedDB; compute SHA-256 in a browser worker using bounded slices instead of copying entire files into memory. Upload through the direct Storage host with authenticated, resumable TUS transfers and 6 MiB chunks. Resume identity includes the account-owned immutable path and checksum; refreshed session credentials are attached to each request. The server verifies 32 MiB ranges per invocation, binding each range to the immutable Storage object version and checking exact size and MIME type. A private checkpoint stores incremental SHA-256 state; only server credentials can read or advance it. HTTP 202 reports verified-byte progress, and clients continue automatically until the full digest matches and the file becomes ready. Checkpoints are removed on completion or purge. This keeps both transfer and verification resumable within Supabase function limits. Staging verification includes a 1,000,000,000-byte upload with interruption/resume, full checksum validation, and an exact-size download with the same digest. Uncertain completed uploads are verified without resending their bytes. Oversized files receive an actionable size error rather than a database constraint message. [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

A file upload and a Postgres transaction are not one atomic operation. Allocate an upload intent, upload to its authorized path, verify/finalize metadata, then attach it through a domain command. Pending and failed states stay explicit. A cleanup job removes abandoned uploads. Check reference ownership and authorization on both upload and attachment; do not delete a file still used by another live record.

### Meaningful history

Write field-level action events in the domain transaction. Separate structural fields useful for behavior analysis from content-bearing fields that must be scrubbed. Avoid recording secrets, unnecessary full-document snapshots, or every autosave keystroke. Persist source references only where useful and distinguish client-reported provenance from trusted server identity. UI availability and retention policy are defined in PRD §5.

### Lifecycle enforcement

Use a deletion timestamp and server-computed purge eligibility to implement PRD §4. Queries and workers exclude trashed content unless explicitly operating on recovery. Maintain parent/child restore relationships; prevent a stale queue from recreating a deleted record. Purge tombstones contain identity/lifecycle metadata, not deleted content.

Purge source rows and content-bearing derivatives: document versions, file objects with no surviving references, text/vector indexes, action payloads, command-result payloads, queued job inputs, and stored errors containing source text. Compact command receipts may retain deduplication metadata but must not return purged content on retry. A queued job must recheck the source lifecycle before reading or writing results.

Remove or redact attributable deleted-source excerpts from retained generated reviews/syntheses; preserve unrelated user content and structural conclusions. Because this can be ambiguous for old free-form output, source attribution and targeted purge verification must be part of the generated-content design. Do not claim successful erasure while a recoverable copy remains in ordinary application data.

Deletion from database and object storage spans systems. Persist purge progress and retry incomplete steps with explicit failure status. Reconnecting clients reconcile tombstones and evict stale caches. Retained operational backups have their own expiry (§9); restoration must not resurrect previously purged content.

## 8. Background Work and Integrations

Calendar and X account connections use `https://<project-ref>.supabase.co/functions/v1/integration-callback` for each environment, separately from the Supabase Auth sign-in callback. Both the staging and production URLs are registered on the Google Web client and the X OAuth app. X is configured as a confidential Web App, matching its server-side token exchange. Google now reaches its unverified-app warning and X reaches its permission consent screen; completed account authorization and synchronization still require verification.

Use Supabase Cron for scheduling and Supabase Queues for durable work. Run short, bounded worker steps in Edge Functions; checkpoint large ingestion batches and resume them through the queue. Queue delivery does not make external side effects exactly once: use idempotency keys, leases, backoff, and explicit terminal failure states. [Queues](https://supabase.com/docs/guides/queues), [scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [runtime limits](https://supabase.com/docs/guides/functions/limits)

| Work | Execution and model boundary |
|---|---|
| X bookmarks | Server-side OAuth tokens, incremental ingestion/deduplication and linked-content extraction; no mandatory generation-model pass |
| GitHub jobs catalog | Poll structured SimplifyJobs data with source validators/cursors; deterministic filtering and deduplication |
| Google Calendar | Read-only backend synchronization for Home; server-stored refresh tokens and web OAuth callbacks |
| Supplied captures | Codex supplies screenshot/media and processed content; validate/store without a second normalization-model call |
| Embeddings | OpenAI embedding API with the retained server-side key; only changed, eligible content is queued |
| Weekly reviews | Hosted ChatGPT Work schedule reads inputs and saves generated content through remote MCP; no Manor-hosted generation-model call |
| Maintenance | Recurrence generation, streak reconciliation, cleanup, purge, and backups; no language model required |

Browser reads of connected accounts, calendars, events, and X connection state go straight to the owner-scoped tables and a small `manor_x_status` RPC; the `integrations` function serves only OAuth, visibility, disconnect, and manual X sync. Google Calendar jobs run on each minute boundary after a successful sync. The existing minute worker claims up to sixteen due accounts per tick and processes one event page for every connected calendar. The owner-wide twelve-calendar cap is serialized in the database; OAuth stores a new Google account and its discovered calendars atomically, rejecting connections that exceed the cap. When the minute sync later discovers calendars beyond the cap on a connected account, it skips them, reports the skipped count, and keeps syncing the stored calendars; a database trigger remains as the final guard against direct inserts. Initial imports may require multiple pages; provider failures retain exponential backoff. Home reads synced events once a minute.

Codex-owned Gmail/Slack/etc. connections are outside this backend. Manor accepts source-independent domain changes and optional provenance, not connector-specific versions of every mutation. Screenshots originate from Codex or user-supplied media. Provider quotas, OAuth requirements, and any X API charges are separate from model usage and must be verified when reconnecting integrations.

For reviews, the first input read freezes an account-owned snapshot, and saves require that snapshot ID, period, timezone, and watermark. Repeated reads preserve the same capture; source purge invalidates it instead of silently rebuilding it. Same-period, same-content saves are idempotent even across distinct command IDs. Compute the PRD window as [previous Sunday 22:00, current Sunday 22:00) in the saved IANA timezone, then resolve each boundary to an instant; do not assume every DST-crossing week lasts exactly 168 hours. Preserve the scheduled cutoff when a run is delayed or retried. Timestamped history uses the half-open interval. Date-keyed habit/mood records use the seven calendar labels Monday through Sunday, so the ending Sunday is not counted again in the following review. Missing values remain unknown and Resting remains explicit. Snapshots label their first capture time and disclose that current daily records may have changed after a delayed cutoff. Server-derived completion event counts are distinct from unique completed-task counts. Staging tests cover both 167-hour and 169-hour DST windows, repeated reads after source edits, idempotent saves, cross-account denial, and purge invalidation.

Validate structured, source-attributed content before saving. Record available execution provenance and input watermark; do not invent host model/token metadata the client does not provide. Retries must not duplicate reviews or mutate tasks. A missed or failed scheduled run remains visible, with an authorized retry using the same period. Verify OAuth access and host write permissions with the laptop and Manor tab closed; scheduling does not itself guarantee unattended writes. No host transcripts, automatic access to ChatGPT Health, or silent API-generation fallback is assumed.

Keep the OpenAI key for separately billed embeddings. Select the embedding model and limits during implementation, track usage, and bound per-job work without inventing a user spending ceiling. Weekly-review reasoning consumes the selected ChatGPT host's allowance rather than Manor's OpenAI API key. Embedding/index migrations must record the model version rather than silently mixing incompatible vectors.

## 9. Backups and Disaster Recovery

Use **daily database backups and daily file backups with seven-day retention**. This is an approximately one-day recovery-point target, contingent on successful runs; monitor actual backup age and failed jobs. It is not a promise of zero data loss or instantaneous recovery. No point-in-time recovery add-on is required for the selected baseline.

Supabase Pro supplies daily database backups with the selected retention. Database backups do not include Storage object contents, and restoring a live database involves downtime. Back up uploaded objects separately. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

![Daily recovery paths](diagrams/recovery.svg)

[Edit the Excalidraw scene](diagrams/recovery.excalidraw).

Each file manifest includes immutable object versions. Record object IDs, paths, checksums, ownership metadata, and the database/export watermark needed to reconcile references. Retain the file versions needed by every retained recovery point; do not simply overwrite a mirror or immediately propagate source deletions into all backup copies. Encrypt backups and restrict restore credentials separately from app credentials.

The [recovery tooling](../tools/recovery/README.md) uses pinned restic for encrypted snapshots and retention, rclone for file transfer, and a daily GitHub Actions workflow template. An independent managed backup store and its credentials must be provisioned before activating the schedule. Coordinate database and file recovery points: a database row is not successfully backed up if its referenced object cannot be restored. Expire snapshots and unreferenced backup objects according to retention, and verify the actual deletion behavior.

Rehearse a restore into an isolated recovery environment before release. Keep ingestion, outbound messages, and generation jobs disabled there. Verify record counts, ownership, relationships, checksums, and representative reads. Apply lifecycle tombstones newer than the restored snapshot before serving recovered data so purged objects do not return. Keep the required content-free deletion ledger independently recoverable from the snapshot being restored. The implemented prepare/checkpoint/acknowledge protocol prevents physical purge until a verified independent ledger snapshot exists. Restoration applies the latest ledger before file reconciliation; recurring occurrence identities prevent rematerialization.

Operational backups can contain subsequently deleted data until their retention expires. They are restricted recovery material, not a second user-accessible archive or a tool-accessible source. If a restore fails or a daily backup is missing, report the gap explicitly rather than silently presenting an older recovery point as current.

## 10. Migration and Verification

The user is not using Manor before the web release, so a read-only cutover window is acceptable. There is no requirement for simultaneous desktop/web writing.

1. Inventory local and cloud ordinary-module data, ownership, file locations, preferences, and legacy history. Snapshot sources without printing private contents.
2. Reconcile duplicates and divergent versions in staging. Preserve both sides of an unresolved conflict until it can be resolved; never let last-write-wins silently discard user work. Preserve existing source/date provenance, mapping the historical `alfred` origin to `codex` only through an explicit, reviewed import transformation. Existing migration files describe deployed history and must not be silently edited to match the target schema.
3. Implement the new schema, shared commands, drafts, files, jobs, and the remote MCP adapter. Verify the target behavior before importing into production.
4. Verify that previously deployed writers and scheduled functions being replaced are disabled; removing their source does not undeploy them. Import/reconcile ordinary records and local files, then validate identities, relationships, hashes, and representative workflows.
5. Enable web writes only after checks pass. Keep rollback snapshots protected through the agreed recovery period. Remove retired deployment configuration and secrets after data reconciliation, while preserving unrelated user work.

Verification must include real integrated flows for account isolation, direct-signup bypass, Google identity verification, unauthorized direct writes, retry after an uncertain commit, concurrent edits, route-independent tools, immediate UI refresh, Notes offline reload and sign-out cancellation, file finalization, parent/child Trash restoration, purge across derivatives, scheduled execution without the browser, and a database-plus-files restore.

Use the repository's required typecheck/build checks after code changes, plus focused integration/end-to-end coverage appropriate to each migration step. No broad mock-based test suite is implied by this document. Keep operational logs structured with command/job IDs and timings; redact secrets and content. Operational diagnostics are distinct from meaningful action history.

## 11. Implementation Details Still to Finalize

The architecture choices above are settled. The following require implementation work or deployment configuration, not another broad product-design round:

- Claiming the selected Vercel name, environment/project identifiers, Google callbacks, and remote MCP OAuth registration.
- End-to-end OAuth and hosted-client verification against the implemented schema and shared catalog; measured latency budgets.
- Independent file backup destination credentials, scheduler activation, and demonstrated remote database-plus-files restore.
- Hosted schedule and write-permission verification before reviews are enabled.

Remaining product scope belongs only in [PRD §13](PRD.md#13-remaining-product-detail). Update this document when implementation resolves technical details; do not keep obsolete alternatives or duplicate source-level API documentation here.
