# Manor PRD

_Last updated: 2026-09-09_

This document owns product behavior, business rules, and scope. [ARCHITECTURE.md](ARCHITECTURE.md) owns the technical design, storage, execution, deployment, and recovery mechanisms.

## 1. Product Thesis

Manor is a personal productivity web app: habits, mood and focus, tasks, LeetCode, job applications, notes, a knowledge base, and a private encrypted Journal. Fitness ingestion is planned. Codex supplies interactive reasoning and conversation, using Manor's WebMCP tools to read and act on the same data as the UI.

It replaces the user’s legacy Notion system (private reference: [workflow workarounds](NOTION-REPORT.md#5-workflow-workarounds)). Logging and maintaining the system should take little effort. Manor has a product bar: account isolation, sign-in, onboarding, settings, empty states, and durable data, even with one primary user.

## 2. Positioning

Manor provides the productivity interface and domain logic; Codex provides the general agent capabilities and connected knowledge sources. Users can work directly in Manor or ask Codex to operate it. Manor does not embed a second conversational agent.

A **module** is a tracker or feature unit. Simple trackers are config-defined (name, fields, cadence, streak participation, presentation); complex modules such as Jobs, LeetCode, and Fitness are code-defined. Mood and Focus are the reference simple trackers. Each account owns its data; collaboration and shared workspaces are outside scope.

## 3. Product Principles

1. **Frictionless logging.** Direct UI actions and Codex requests should complete with minimal steps.
2. **Little maintenance.** No manual syncing, filter rotation, or bookkeeping to keep the system usable.
3. **Streaks are core behavior.** Preserve the mechanics in §6 through the migration.
4. **Useful synthesis.** Daily debriefs and scheduled weekly reviews make accumulated data useful without unsolicited changes to the user's work.
5. **Consistency by design.** Habits and mood/focus allow today and yesterday; LeetCode attempts may record any past date, never a future date.
6. **Expressive, efficient design.** Celebration and urgency are restrained; content uses space well. Follow the design charter while exploring the chosen UI redesign.
7. **Fast, truthful state.** Tool results and visible UI agree with committed data. Unsaved work, conflicts, and failures must remain visible.

## 4. Platform and Data Policies

### Platform

Manor is a WebMCP-native web app intended to remain open in the ChatGPT/Codex built-in browser. Codex supplies interactive conversation and agent capabilities. Remove Electron support and embedded Alfred; recreating native summon UI, desktop hotkeys, permission onboarding, or notifications is not required. The technical migration and current implementation status live in [ARCHITECTURE.md](ARCHITECTURE.md).

### Reliable data and offline work

UI actions and agent actions obey the same business rules. Results must reflect persisted outcomes, without duplicate changes on retry or silent overwriting of concurrent edits. Relevant views update promptly; unsaved work and failures remain visible.

Notes preserve drafts and pending attachments through connection loss and reloads. Distinguish local protection from cloud saving. Other modules require connectivity to save. **Explicit sign-out automatically cancels while unsynced Notes work remains**, keeping the session and drafts intact with a clear explanation. There is no download, discard, or forced-sign-out alternative in that flow. Ordinary session expiry preserves drafts for the same account to recover after signing in again.

### Accounts and dates

Signup requires the normal account details, then a shared signup password before the account is created. That gate is separate from the account login password. New users verify their email before using Manor; existing-account login does not require the shared gate password. Account data remains private to its owner.

Each account saves a timezone, initially taken from the system. Travel does not silently change it. Use it consistently for today/yesterday, streak boundaries, recurrence, and scheduled reviews. Changing timezone does not relabel existing daily history; calendar events preserve their intended instants.

### Recovery and retention

Tasks, job applications, and Notes share recoverable Trash for seven days, then automatic purge. Deleting a note includes its subpages; restoration preserves their relationships. Archiving is distinct from Trash. Habit retirement remains archival under §6. Journal has its separate lifecycle (§7.9).

Attached files follow the parent lifecycle, but purging one record must not delete a file still used elsewhere. After purge, ordinary application data and tools must not recover the deleted content through history, old versions, search, or derived outputs. Structural behavioral history may remain (§5). Stale clients must not resurrect deleted records.

Disaster recovery uses daily database and file backups with seven-day retention; up to a day of recent changes may be lost after a failure. Restricted backups can retain subsequently deleted content until they expire. They are not an additional user-visible archive. See ARCHITECTURE for [purge enforcement](ARCHITECTURE.md#7-files-history-and-purge) and [disaster recovery](ARCHITECTURE.md#10-backups-and-disaster-recovery).

### Existing data

Preserve ordinary module records and files through migration. A read-only cutover window is acceptable; the user does not plan to use Manor until the web release. The user reports no Journal content to preserve and authorizes discarding its legacy data. This exception does not apply to other modules.

## 5. Codex, WebMCP, and Background Work

### Authority and tool coverage

Explicitly requested reads, creates, edits, archiving, deletion, and restoration execute directly, subject to domain rules and account authorization. Manor adds no blanket confirm-back or approval screen. Codex operates when invoked by the user; it is not independently rewriting notes. Real ambiguity or conflicting edits can require clarification. Host-level permissions remain outside Manor's control.

Tools must offer comprehensive reads, search, filters, summaries, aggregates, precise edits, useful bulk actions, lifecycle operations, and meaningful action history across permitted modules. The agent should not need to navigate to each page before acting. It should understand the open object, selection, and unsaved state where relevant. No unrestricted database access.

Authorized note edits apply directly, preserving unsaved user text and surfacing genuine conflicts. Fast execution and accurate UI reflection are acceptance requirements. Tool contracts and state coordination belong in [ARCHITECTURE §5](ARCHITECTURE.md#5-queries-realtime-and-webmcp).

### Integration boundary

Codex may read Gmail, Slack, calendar, or other connected sources through its own integrations and call ordinary Manor tools to update tasks or other records. Manor's domain tools are source-independent. Optional provenance can reference the source that motivated a change; do not build a separate task tool for each provider.

Manor maintains the Home calendar feed, X bookmark ingestion, and jobs catalog ingestion independently of Codex conversations. Google Calendar remains read-only, with multiple accounts and per-calendar visibility; scratch blocks never write back. Codex supplies captures and processed content; Manor stores them without requiring a second AI normalization pass (§7.8).

### Daily synthesis and weekly review

A debrief through **voice or typed Codex conversation** updates the same daily synthesis (§7.2). Do not store a separate summary per session or a transcript in Manor. Preserve relevant earlier context while incorporating additions and corrections.

An automatically scheduled weekly review uses stored, AI-accessible Manor data and meaningful action history. Backend generation uses a separately billed model API call. It writes to a **dedicated weekly-review surface in Manor**. Reviews summarize and suggest; task or note changes happen when requested, not merely because a review suggested them. The schedule, report sections, and review interaction details remain open. Generation must work without an open browser or Codex conversation. The job design lives in [ARCHITECTURE §8](ARCHITECTURE.md#8-background-work-and-integrations).

### Action history

Keep account-scoped, durable history of meaningful state changes by the user, Codex, and background operations. Expose it through WebMCP; **do not provide an Activity/history page in Manor**. Record field changes and useful provenance for analysis, not navigation, clicks, keystrokes, reads, or no-op writes. History survives sign-out and is retained until explicitly cleared, subject to content scrubbing on purge (§4).

After an object is purged, keep only structural information useful for behavior analysis, such as that an unidentified task was postponed or an application changed stage. Remove identifying titles, document contents, old text values, source excerpts, and other recoverable deleted content. Journal operations never enter this history.

### Notifications

Proactive Manor notifications are deferred to the future native iOS companion, intended as the primary delivery channel. Keep useful due and at-risk states inside Manor. Do not recreate Electron reminders or treat Codex's own completion/attention notifications as a Manor notification API.

## 6. Streak System (Duolingo-derived, adapted)

- **Per-habit streaks.** No single global streak.
- **Perfect day:** every *active* habit completed (paused habits excluded; LeetCode excluded). Perfect days earn spent freezes back.
- **Freeze pool:** a shared monthly pool sized to the number of habits in play (a new habit adds one, retiring removes one; the count resets from the active roster each month). **Every month opens with a full pool** (2026-08-27); perfect days earn spent freezes back, capped at capacity. Freezes are **spent by hand, never automatically** (2026-08-26): a freeze covers one habit on one day, never a whole day. Missing a habit breaks that habit's streak, and the next day you either backfill its check-off or spend a freeze on it. Any number of habits can be covered on one day while the pool lasts, one freeze per habit per day. Breaking a day forfeits the grant that day would have earned, so covering two misses on one day needs a freeze banked earlier. Freezes reach exactly as far back as habit backfill: yesterday only. Spending a freeze and then backfilling the real check-off refunds it automatically.
- **Earn-Back:** when a streak breaks with an empty pool, two clean days within 48 hours restore it — once per habit per month. The only recovery path.
- **Gold state:** seven freeze-free days per habit. Communicated by design (gilded flame/number), never by text chips.
- **Habit shape:** binary, or quantized with a step ladder derived from the target label (decision-paralysis guard — a fixed ladder, no free-form amounts). A target reading "N units" with N up to 8 logs one step per unit ("3 tablets" cycles 0/33/66/100); larger or unitless targets log in quarters. Entries store integer percents 1-100; only 100 counts as complete. Habits can be added, retired, or paused any time; a mid-month habit starts at streak 0 and immediately counts toward perfect day. **Retire is the only removal path** (2026-08-26): it archives the habit, keeping every entry, streak and spent freeze, and it can be reactivated from the archive at any time (the gap days count as misses; the old streak does not resume). There is no permanent delete.
- **LeetCode is separate:** its own streak (≥1 problem logged that day), its own pool of 5/month, no Earn-Back, excluded from perfect day.
- **Backfill:** one day for habits and mood/focus; same-day edits allowed. LeetCode attempts backfill freely into the past (curriculum history, not a daily rhythm).
- **Urgency:** at-risk emphasis on the habit surface; proactive notification delivery follows §5.

## 7. Modules (v1)

### 7.1 Habits
Daily check-off and streak home (check-off lives here, not on Home). Full-fidelity views: per-habit month grid, week strips, best/current streaks, freeze pool as a first-class object. Add/pause/retire flows, plus an Archived section on the daily view that reactivates a retired habit. Freezes are spent from the habit's row on the Yesterday view: a missed row offers a Freeze control that toggles back off, and the pool balance moves with it.

### 7.2 Mood & Focus (reference config-defined trackers)

One date-keyed record per day with independently loggable Mood (Great/Good/Neutral/Bad/Awful) and Focus (Locked In/High/Medium/Low/Locked Out/Resting). Either signal saves in one tap; a missing signal differs from Resting. Save explicitly stated ratings directly; ask before saving an inferred rating. Narrative synthesis may be inferred from the conversation without inventing explicit ratings.

Each day has one evolving synthesis updated through Codex (§5). The page has no manual typed-context composer; typed debriefs happen in Codex. Existing manually written context remains readable with its original provenance. Today and yesterday are editable; older records are read-only. History supports navigable months, compact daily records, and a shared longer-range Mood/Focus view. Debrief content is AI-accessible; private journaling belongs in §7.9.

### 7.3 Tasks
- **One merged task system** for academic and personal work with contexts (Uni, Personal, Leetcode, Apps, Hackathons). Contexts carry a user-chosen icon and semantic color that persist anywhere the context is shown. Fields: status, due, context, difficulty (time-estimate), priority, recurrence with full rule granularity (specific weekdays, intervals, end dates).
- **Due buckets are computed** (Overdue/Today/Tomorrow/This Week) — never a hand-maintained select. The Home kanban groups by bucket, Notion-board DNA.
- **Weekly and Master task views.** Weekly is the computed due-bucket board, ordered by exact due date and then High → Medium → Low priority. Master is the longer-horizon task table with title search, a fixed due-first ordering, and an additive property-filter builder for Context, Status, Priority, and Due date. Applied filters clear in one action without deleting saved views; filter sets can be named and saved as reusable views. Overdue has no creation path; Today and Tomorrow create on their exact date; This Week requires an exact date within the remaining seven-day board horizon before creation. New-task Context begins unset and must be selected or created. Dragging between exact-date buckets changes the due date; dropping onto This Week opens the due-date editor because a range is not a date. Single click opens centered task detail. Edits form a local draft with Save changes; closing commits the draft, and a failed save must retain it. Completion stays on the card checkbox. The Master view has By context grouping and a Completed toggle; the working view excludes completed tasks. Keep duplication and accessible task action menus without delaying single-click opening.
- **Recurrence:** each scheduled occurrence is independently tracked. A missed occurrence stays overdue until completed or explicitly skipped. Completing one occurrence does not erase missed ones.
- **Contexts:** names, icons, and colors are editable. Renames preserve task and saved-view references; reject duplicate names. Refuse removal while tasks reference the context or when it is the last available context.
- **No calendar workspace.** Manor does not ship its own calendar surface; Notion Calendar (the app) covers calendaring. Day events from connected calendars appear only in the Home Today timeline, and scratch blocks remain Manor-only Home objects.
- **Today timeline is direct-manipulation paper:** scratch blocks (sticky notes) drag vertically to reschedule (15-minute snap), and dragging on empty timeline creates a new sticky over that range and opens its dialog. Stickies may be freestanding notes or time-block a task.
- **Scratch blocks:** tasks (or parts of tasks) drag onto the Today or Tomorrow schedule as Manor-only time blocks — never written to Google. The visible scheduling range is 6 AM through midnight. Placement snaps to 15 minutes; the task estimate supplies the initial duration (one hour when unset), then date, start, duration, and the portion label can be edited independently. No auto-capture of progress (plans are scratch); blocks self-delete 48 hours after their scheduled end; the task is untouched.

### 7.4 Fitness
Fed nightly by a deliberately low-tech pipeline: the user screen-records the Bevel iPhone app (10–20s) and Manor runs a backend **ingestion + normalization job** (schemas to be locked before build). Minimum outputs: calories in/out/deficit and the 9 muscle groups worked. There is no standalone Fitness page; the normalized data remains available to the system. Sleep remains a manual habit until the iOS app unlocks HealthKit relay.

### 7.5 LeetCode
Manual logging against the Neetcode 150 curriculum: topic progress with real problem lists, own streak and pool (§6), daily solve intensity. A curriculum problem is a stable record, separate from its attempt history. Every solve or review appends a durable attempt with an editable date and the exact pasted solution source; repeating a problem never overwrites an earlier attempt or creates a duplicate problem. Distinct-solved progress counts each problem once, while attempt totals and daily intensity count every solve/review. Any attempt logged that day satisfies the LeetCode streak day. A synced mistakes log supports creating, editing, and deleting short notes (up to 2,000 characters), newest first. Plotting/chart treatment is still an open design area.

### 7.6 Jobs

**Board, Flow, and Browse** are separate views. The board begins at To apply, then Applied → OA → Interview 1 → Interview 2 → Interview 3 → Offer/Rejected. Browse is the SimplifyJobs catalog; a listing joins the user's pipeline only when explicitly added. No automatic pipeline imports. Search and additive AND filters cover hiring cycle, category, company, location, posted date, and added date; view state survives navigation within the session.

Ingestion polls the structured `listings.json` source and deduplicates entries. Preserve the current standing filters: visible, open, non-hardware, at least one US location, and Fall 2026 or later when a cycle is specified; unspecified cycles remain eligible. Revising the cycle cutoff is an open catalog-policy detail, not an automatic consequence of migration. Page through all eligible listings. Group equivalent company/role/location/cycle listings with an openings count.

Roles share one editable schema: company, role, location, posting link, hiring cycle, posting date, stage, applied date, OA due date, three interview dates, decision date, and applied resume version. Unset values stay blank; there is no generic role Notes field. Manual creation supports non-feed roles. Details use centered dialogs with directly editable dates.

Persist stage transitions. Board cards show the current meaningful update. Flow begins at Applied and derives the role's path from history; a backwards stage correction removes the undone hops from the displayed path so repeated dragging cannot inflate progress. Expose chart values to assistive technology. Resume PDFs are private cloud files with named versions; roles reference the version used, without deleting a shared file when one role is purged.

### 7.7 Notes
Notes is a cloud-backed document workspace with protected browser-local drafts and queued saves (§4). Pages support folders, nested page hierarchy, favorites, recents, archive, Trash, full-text search, duplication, movement, Markdown import/export, and durable app-owned attachments. Documents preserve their full native structure; Markdown is an explicitly lossy interchange format. The editor covers paragraphs, three heading levels, bulleted and numbered lists, toggles, quotes, dividers, callouts, code with language-aware highlighting, inline formatting and links, text/background colors, tables, images, audio, video, files, block selection/reordering, slash commands, Markdown shortcuts, internal page mentions, inline and block equations, a live heading-based table of contents, web bookmarks, sandboxed web embeds, and resizable two-column document layouts that stack responsively. Markdown import recognizes inline and block LaTeX; export converts live contents to anchor links, bookmark/embed blocks to ordinary links, and columns to sequential sections because Markdown has no lossless equivalents for those layouts. Checklists, databases, and timeline views are task/project-management features and do not belong in Notes. Autosave failures remain visible and retryable. AFFiNE and BlockSuite remain interaction references; the editor and persistence design live in [ARCHITECTURE §6](ARCHITECTURE.md#6-notes-drafts-and-editing). Find-in-note highlights matching text and supports next/previous navigation without changing document contents. Moving a page to Trash includes its subpages; recovery and purge follow §4. Agent editing follows §5.

### 7.8 Knowledge Base (X bookmarks and captures)

X bookmarks and Codex-supplied captures share the knowledge base. Codex or the user supplies source links, screenshots/media, and processed content; Manor saves it for retrieval without a second mandatory normalization-model pass. Existing capture assets remain available. Embedding captured content is separate background work.

X bookmarks (not likes) are ingested periodically, including linked article content where available. Preserve source bookmark order. Captures show meaningful pending/failed states and retry. Text and semantic retrieval are available through Manor tools. The page uses compact rows, with no read/unread state; capture screenshots need not appear in the list. See [ARCHITECTURE §8](ARCHITECTURE.md#8-background-work-and-integrations) for ingestion and model boundaries.

### 7.9 Journal

The Journal remains part of Manor, with Manor branding, on a separate browser surface outside Codex. It is **end-to-end encrypted and unlocked with a separate Journal passphrase**. There is **no recovery key**. Losing the passphrase means losing access; account-password reset and backups do not bypass encryption.

Zero AI access remains binding: no Journal content in tools, embeddings, search, daily synthesis, reviews, or action history. Keep it outside Computer History and screen sharing. It must not decrypt inside the agent's browser. The technical privacy boundary and its limits live in [ARCHITECTURE §9](ARCHITECTURE.md#9-journal-encryption-boundary).

Retain one entry per day and explicit confirmed permanent deletion within the Journal. Journal entries do not use ordinary Manor Trash. The legacy Journal can be discarded as specified in §4.

## 8. Surfaces

- **Home = tasks kanban + Today timeline.** Events, scratch blocks, now-line, and scheduling live here; habit logging lives on Habits.
- **Sidebar:** docked by default; one toggle, no pin concept. Collapsed mode reveals a floating overlay on left-edge hover and dismisses on leave; toggling docks it. Persist the choice. Provide navigation to the modules and dedicated weekly reviews. The Journal entry opens its separate external surface (§7.9).
- **Product surfaces:** gated signup, login, onboarding, Settings, account and integration management, appearance preferences, recovery/Trash, and designed empty states. Remove desktop hotkey/permission onboarding and embedded-agent settings. No Activity page.
- **Object details:** centered dialogs. Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited. This does not change primary page layouts, the sidebar, inline popovers, menus, or tooltips.
- **iOS, later:** native companion, primarily for notifications, with capture, widgets, and HealthKit relay to be scoped after the web work.

## 9. Design System

Redesign the UI using real Mobbin flows. The existing UX is broadly satisfactory; visual direction and specific workflow changes are chosen during design work. The current light Paper/violet charter in [DESIGN.md](DESIGN.md) remains the baseline until those choices are made. No mascots or characters. Typography, component treatments, copy, and motion rules have one home in the charter and the operational constraints in [AGENTS.md](../AGENTS.md).

The application mock data is the single canonical showroom story. Signed-in surfaces must use real account data, including honest empty states; they never substitute showroom records.

## 10. Delivery Priorities

**P0: correct, complete web foundation.** Account gating and isolation; authoritative data and shared operations; preservation and migration of existing data; robust WebMCP coverage; cache consistency and conflict handling; offline note protection; file storage; seven-day Trash and purge; saved timezone; existing module mechanics; daily synthesis; durable tool-accessible action history; the separate encrypted Journal boundary. The retained UI must be connected to the web foundation before release.

**P1: synthesis and refinement.** Scheduled weekly reviews with their dedicated surface, richer retrieval and analysis over retained history, and the Mobbin-informed UI redesign. Essential tool reads, writes, search, and useful bulk operations are P0; P1 must not become a reason to ship a narrow toolset. Final design sequencing can run alongside the foundation once data contracts are stable.

This is planned delivery scope, not a claim that the features already exist. Technical acceptance and migration checks live in [ARCHITECTURE §11](ARCHITECTURE.md#11-migration-and-verification).

## 11. Non-Goals and Deferred

**Non-goals:** Electron support; an embedded conversational/voice agent; recreating native summon UI; unrestricted agent database access; any AI access to the Journal; a user-facing action log; multi-user collaboration, teams, or sharing; a general-purpose Notion competitor; a standalone calendar workspace; mascots or characters.

**Deferred:** native iOS and proactive notification delivery; finance and media modules; additional jobs sources; Google Calendar push updates and iCloud CalDAV; fitness ingestion until its schemas are agreed. Notes cloud storage is part of the web foundation, not deferred.

## 12. Decision Log

This is a concise record of decisions that govern the current target; superseded desktop requirements and implementation-fix chronology have been removed. Current behavior is specified in the sections above.

| Date | Decision |
|---|---|
| 2026-08-19 | Manor product and core tracker mechanics selected (§§1–3, 6). |
| 2026-08-22 | Merged task workspace, attempt-based LeetCode history, rich Notes, and centered object details established (§§7–8). |
| 2026-08-23 | Paper design baseline selected; standalone calendar workspace removed (§§7.3, 9). |
| 2026-08-26 | Manual habit freezes and non-destructive retirement selected; Jobs Browse requires explicit pipeline addition (§§6, 7.6). |
| 2026-08-27 | Monthly freeze pool starts full (§6). |
| 2026-08-29 | Editable contexts, LeetCode mistakes log, and note finding/lifecycle refinements established (§7). |
| 2026-09-09 | Full WebMCP web migration, Codex as interactive agent, and UI redesign chosen (§§4–5, 9); technical design is owned by ARCHITECTURE.md. |
| 2026-09-09 | Signup gate, direct requested operations, saved timezone, seven-day Trash, recurrence occurrences, daily synthesis, and private tool-accessible history resolved (§§4–7). |
| 2026-09-09 | Final follow-up: separate encrypted external-browser Journal; Notes included in Trash; structural history survives content purge; dedicated weekly-review surface; voice and typed Codex debriefs (§§4–8). |
| 2026-09-09 | Email verification, passphrase-only Journal without recovery key, automatic cancellation of sign-out with unsynced drafts, separately billed backend reviews, and daily database/file backups selected (§§4–5, 7.9). |

## 13. Open Product Decisions

- Weekly review schedule, report sections, and interaction details. Automatic backend generation and a dedicated Manor surface are selected.
- Mobbin-informed visual direction, chart language, and component details.
- Config-defined tracker field catalog; jobs standing-filter maintenance; Bevel-clip ingestion schemas.
- Recurring-series edit scope: how users distinguish an individual occurrence from future occurrences while preserving history.
- Native iOS scope, including notifications and HealthKit relay.

Remaining technical configuration and verification are tracked only in [ARCHITECTURE §12](ARCHITECTURE.md#12-implementation-details-still-to-finalize).
