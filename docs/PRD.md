# Manor PRD

_Last updated: 2026-09-13_

This page defines what Manor does: its behavior, business rules, and scope. The technical design, storage, execution, deployment, and recovery mechanisms are in the [architecture](ARCHITECTURE.md), and the visual direction is in the [design charter](DESIGN.md).

## Product thesis

Manor is a personal productivity web app for habits, mood and focus, tasks, LeetCode practice, job applications, notes, and a knowledge base. Fitness ingestion is planned. Codex supplies interactive reasoning and conversation, using Manor's MCP tools to read and act on the same data as the UI.

Manor replaces your legacy Notion system (private reference: [workflow workarounds](NOTION-REPORT.md#5-workflow-workarounds)). Logging and maintaining it takes little effort. Even with one primary user, Manor meets a product bar: account isolation, sign-in, onboarding, settings, empty states, and durable data.

## Positioning

Manor provides the productivity interface and domain logic; Codex provides the general agent capabilities and connected knowledge sources. You can work directly in Manor or ask Codex to operate it. Manor doesn't embed a second conversational agent.

A **module** is a tracker or feature unit. Simple trackers are config-defined internally (name, fields, cadence, streak participation, presentation); the first web release has no custom tracker builder. Complex modules such as Jobs, LeetCode, and Fitness are code-defined. Mood and Focus are the reference simple trackers. Each account owns its data; collaboration and shared workspaces are out of scope.

## Product principles

1. **Frictionless logging.** Direct UI actions and Codex requests complete in minimal steps.
2. **Little maintenance.** No manual syncing, filter rotation, or bookkeeping keeps the system usable.
3. **Streaks are core behavior.** The mechanics in the [streak system](#streak-system) carried over from the legacy system unchanged.
4. **Useful synthesis.** Daily debriefs and scheduled weekly reviews make accumulated data useful without unsolicited changes to your work.
5. **Consistency by design.** Habit logging and quick mood and focus capture accept today and yesterday. Mood and focus history and LeetCode attempts accept any past date, never a future date.
6. **Expressive, efficient design.** Celebration and urgency are restrained, and content uses space well, following the design charter.
7. **Fast, truthful state.** Tool results and the visible UI agree with committed data. Unsaved work, conflicts, and failures stay visible.

## Platform and data policies

### Platform

Manor is a web app. Agents operate it through remote MCP, which needs no open Manor page, and Codex supplies the conversation and agent capabilities. There is no Electron app, embedded Alfred assistant, native summon UI, desktop hotkey, permission onboarding, or desktop notification. Implementation status is in the architecture's [status section](ARCHITECTURE.md#status).

### Reliable data and offline work

UI actions and agent actions obey the same business rules. Results reflect persisted outcomes, without duplicate changes on retry or silent overwriting of concurrent edits. Relevant views update promptly, and unsaved work and failures stay visible.

Notes preserve drafts and pending attachments through connection loss and reloads, and the UI distinguishes local protection from cloud saving. Other modules require connectivity to save. **Explicit sign-out cancels automatically while unsynced Notes work remains**, keeping the session and drafts intact with a clear explanation; there is no download, discard, or forced-sign-out alternative in that flow. Ordinary session expiry preserves drafts for the same account to recover after signing in again.

### Accounts and dates

Account creation and sign-in use Google OAuth only. Manor has no local password, email-and-password signup, password reset, or verification email; Google supplies the verified identity. A new user also passes the shared signup-password gate before the Manor account is created, and returning users sign in with Google without repeating the gate. Display names are independent of authentication, and account data stays private to its owner. Connecting Google Calendar is a separate, optional consent.

Each account saves a time zone, initially taken from the system, and travel doesn't silently change it. That time zone governs today and yesterday, streak boundaries, recurrence, and scheduled reviews. Changing it doesn't relabel existing daily history, and calendar events keep their intended instants.

### Recovery and retention

Tasks, job applications, and Notes share a recoverable Trash for seven days, then purge automatically. Deleting a note includes its subpages, and restoration preserves their relationships. Notes in Trash can also be deleted permanently at once, one or many, after a confirmation; that is yours alone, and agents can only move records to Trash and restore them. Archiving is distinct from Trash, and habit retirement is archival under the streak system.

Attached files follow the parent lifecycle, but purging one record never deletes a file still used elsewhere. After purge, ordinary application data and tools can't recover the deleted content through history, old versions, search, or derived outputs; structural behavioral history can remain (see [action history](#action-history)). Stale clients can't resurrect deleted records.

Disaster recovery uses daily database and file backups with seven-day retention, so up to a day of recent changes can be lost after a failure. Restricted backups can retain subsequently deleted content until they expire; they are not an additional user-visible archive. The mechanisms are in the architecture's [purge enforcement](ARCHITECTURE.md#lifecycle-enforcement) and [disaster recovery](ARCHITECTURE.md#backups-and-disaster-recovery) sections.

### Existing data

Ordinary module records and files were preserved through migration, with a read-only cutover window. Legacy Journal data was discarded along with the removed Journal feature (see [non-goals](#non-goals-and-deferred-work)); every other module kept its data.

## Codex, agent tools, and background work

### Authority and tool coverage

Explicitly requested reads, creates, edits, archiving, deletion, and restoration execute directly, subject to domain rules and account authorization; Manor adds no blanket confirmation or approval screen. Codex operates when you invoke it and doesn't rewrite notes on its own. Real ambiguity or conflicting edits can require clarification, and host-level permissions are outside Manor's control.

Tools offer comprehensive reads, search, filters, summaries, aggregates, precise edits, useful bulk actions, lifecycle operations, and meaningful action history across permitted modules. The accepted catalog is the architecture's [accepted tool surface](ARCHITECTURE.md#accepted-tool-surface). Depth and speed are requirements: meaningful operations complete in bounded batches with few intermediate calls when intent and targets are clear, and the agent never has to navigate to a page before acting. There is no unrestricted database access.

Authorized note edits apply directly, preserving unsaved text and surfacing genuine conflicts. When you ask for suggestions or select suggestion mode, proposed edits persist in Notes until accepted or rejected individually or together. That review mode is optional, not a gate for ordinary requested edits. Fast execution and accurate UI reflection are acceptance requirements; contracts and state coordination are in the architecture's [queries, realtime, and MCP](ARCHITECTURE.md#queries-realtime-and-mcp) section.

### Integration boundary

Codex can read Gmail, Slack, calendar, or other connected sources through its own integrations and call ordinary Manor tools to update tasks or other records. Manor's domain tools are source-independent, and optional provenance can reference the source that motivated a change; there is no separate task tool per provider.

Manor maintains the Home calendar feed, X bookmark ingestion, and jobs catalog ingestion independently of Codex conversations. Google Calendar is read-only, with multiple accounts and per-calendar visibility. At most twelve calendars total across connected Google accounts are allowed, counting hidden calendars; a connection that would exceed the limit is rejected, and a calendar that later appears on a connected account beyond the limit is not added while the connected calendars keep syncing. Connected calendars sync every minute during normal operation, and scratch blocks never write back. Codex supplies captures and processed content, and Manor stores them without a second AI normalization pass (see [knowledge base](#knowledge-base)).

### Daily synthesis and weekly review

A debrief through voice or typed Codex conversation updates the same daily synthesis (see [mood and focus](#mood-and-focus)). Manor stores no per-session summary or transcript; relevant earlier context is preserved while additions and corrections are incorporated.

A scheduled ChatGPT Work task generates the weekly review and saves it through remote MCP to a dedicated weekly-review surface in Manor. It runs every Sunday at 10 PM in the saved account time zone and covers the previous Sunday at 10 PM up to the current Sunday at 10 PM: habits, mood, focus, and task completion, using stored AI-accessible records and meaningful history. Reviews summarize and suggest; they don't change tasks or notes. The run doesn't depend on the laptop or a live Manor tab. Host scheduling, connection permissions, and unattended writes are verified end to end before release, and Manor doesn't substitute a separately billed generation job. The execution design is in the architecture's [background work](ARCHITECTURE.md#background-work-and-integrations) section.

### Action history

Manor keeps an account-scoped, durable history of meaningful state changes by you, Codex, and background operations, exposed through agent tools; there is no Activity or history page. It records field changes and useful provenance for analysis, not navigation, clicks, keystrokes, reads, or no-op writes. History survives sign-out and is retained until explicitly cleared, subject to content scrubbing on purge.

After an object is purged, only structural information useful for behavior analysis remains, such as that an unidentified task was postponed or an application changed stage. Identifying titles, document contents, old text values, source excerpts, and other recoverable deleted content are removed.

### Notifications

Proactive Manor notifications are deferred to the future native iOS companion, which is the intended delivery channel. Useful due and at-risk states stay inside Manor. Codex's own completion and attention notifications are not a Manor notification API.

## Streak system

The mechanics derive from Duolingo's, adapted. The following diagram shows how one habit's day resolves.

![How a habit day resolves: a completed habit extends its streak and, when every active habit is done, the perfect day returns a spent freeze; a missed habit can be backfilled or covered with a freeze the next day, otherwise the streak breaks and two clean days within 48 hours restore it once per month, or it starts over.](diagrams/streaks.svg)

- **Per-habit streaks.** There is no single global streak.
- **Perfect day.** Every *active* habit is complete (paused habits and LeetCode excluded). Perfect days earn spent freezes back.
- **Freeze pool.** A shared monthly pool sized to the number of habits in play: a new habit adds one, retiring removes one, and the count resets from the active roster each month. Every month opens with a full pool, and perfect days earn spent freezes back up to capacity. Freezes are spent by hand, never automatically: a freeze covers one habit on one day, never a whole day. Missing a habit breaks that habit's streak, and the next day you either backfill its check-off or spend a freeze on it. Any number of habits can be covered on one day while the pool lasts, one freeze per habit per day. Breaking a day forfeits the grant that day would have earned, so covering two misses on one day needs a freeze banked earlier. Freezes reach exactly as far back as habit backfill: yesterday only. Spending a freeze and then backfilling the real check-off refunds it automatically.
- **Earn-Back.** When a streak breaks with an empty pool, two clean days within 48 hours restore it, once per habit per month. It is the only recovery path.
- **Gold state.** Seven freeze-free days per habit, communicated by design (a gilded flame and number), never by text chips.
- **Habit shape.** Binary, or quantized with a step ladder derived from the target label (a fixed ladder guards against decision paralysis; there are no free-form amounts). A target reading "N units" with N up to 8 logs one step per unit ("3 tablets" cycles 0, 33, 66, 100); larger or unitless targets log in quarters. Entries store integer percents 1 to 100, and only 100 counts as complete. Habits can be added, retired, or paused any time; a mid-month habit starts at streak 0 and immediately counts toward perfect day. Retire is the only removal path: it archives the habit, keeps every entry, streak, and spent freeze, and the habit can be reactivated from the archive at any time (the gap days count as misses; the old streak doesn't resume). There is no permanent delete.
- **LeetCode is separate.** It has its own streak (at least one problem logged that day), its own pool of five a month, no Earn-Back, and is excluded from perfect day.
- **Backfill.** One day for habits and quick mood and focus capture, with same-day edits allowed. Mood and focus history permits older corrections and missing-day logging. LeetCode attempts backfill freely into the past because they are curriculum history, not a daily rhythm.
- **Urgency.** At-risk emphasis lives on the habit surface; proactive delivery follows the [notifications](#notifications) policy.

## Modules

### Habits

Habits is the daily check-off and streak home; check-off lives here, not on Home. History combines per-habit month grids with 3, 6, and 12-month completion trends across all habits or one selected habit. Completion rates use eligible tracked days: periods before creation, paused or retired periods, and future dates don't count as missed days. The page keeps week strips, best and current streaks, and the freeze pool as a first-class object, with add, pause, and retire flows and an Archived section on the daily view that reactivates a retired habit. Freezes are spent from the habit's row on the Yesterday view: a missed row offers a Freeze control that toggles back off, and the pool balance moves with it.

### Mood and focus

Mood and Focus are the reference config-defined trackers: one date-keyed record per day with independently loggable Mood (Great, Good, Neutral, Bad, Awful) and Focus (Locked In, High, Medium, Low, Locked Out, Resting). Either signal saves in one tap, and a missing signal differs from Resting. Explicitly stated ratings save directly; Codex asks before saving an inferred rating, and narrative synthesis can be inferred from conversation without inventing explicit ratings.

Each day has one evolving synthesis updated through Codex. The page has no typed-context composer; typed debriefs happen in Codex, and existing manually written context stays readable with its original provenance. Quick capture accepts today and yesterday. In History, you can edit ratings for any past day or add a missing day in the saved account time zone; future dates are unavailable, and historical corrections preserve the daily synthesis and other existing fields. History supports navigable months, compact daily records, and a shared longer-range Mood and Focus view. Debrief content is AI-accessible.

### Tasks

- **One merged task system** covers academic and personal work with contexts (Uni, Personal, Leetcode, Apps, Hackathons). Contexts carry a chosen icon and semantic color that persist anywhere the context appears. Fields: status, due, context, difficulty (time estimate), priority, and recurrence with full rule granularity (specific weekdays, intervals, end dates).
- **Due buckets are computed** (Overdue, Today, Tomorrow, This Week), never a hand-maintained select. The Home kanban groups by bucket.
- **Weekly and Master views.** Weekly is the computed due-bucket board, ordered by exact due date and then High, Medium, Low priority. Master is the longer-horizon task table with title search, a fixed due-first ordering, and an additive property-filter builder for Context, Status, Priority, and Due date. Applied filters clear in one action without deleting saved views, and filter sets can be named and saved as reusable views. Overdue has no creation path; Today and Tomorrow create on their exact date; This Week requires an exact date within the remaining seven-day board horizon. A new task's Context begins unset and has to be selected or created. Repeats is available during creation, and the first save creates the selected recurrence schedule. Dragging from any other bucket into Today or Tomorrow changes the due date to that day; dropping onto This Week opens the due-date editor because a range is not a date. A single click opens the centered task detail. Edits form a local draft with **Save changes**; closing commits the draft, and a failed save retains it. Completion stays on the card checkbox. The Master view has By context grouping and a Completed toggle, and the working view excludes completed tasks. Duplication and accessible task action menus exist without delaying single-click opening.
- **Recurrence.** Each scheduled occurrence is tracked independently. A missed occurrence stays overdue until completed or explicitly skipped, and completing one occurrence doesn't erase missed ones. Editing recurrence supports this occurrence or this and future occurrences; completed, skipped, and historical occurrences keep their outcomes.
- **Contexts.** Names, icons, and colors are editable. Renames preserve task and saved-view references, and duplicate names are rejected. Removal is refused while tasks reference the context, including recoverable tasks in Trash. The last context can be removed when unused; creating a task still requires selecting or creating one.
- **No calendar workspace.** Manor doesn't ship a calendar surface; Notion Calendar covers calendaring. Day events from connected calendars appear only in the Home Today timeline, and scratch blocks are Manor-only Home objects.
- **Direct manipulation on the Today timeline.** Scratch blocks drag vertically to reschedule with a 15-minute snap, and dragging on empty timeline creates a block over that range and opens its dialog. Blocks can be freestanding notes or time-block a task; their visual treatment follows the design charter.
- **Scratch blocks.** Tasks, or parts of tasks, drag onto the Today or Tomorrow schedule as Manor-only time blocks that are never written to Google. The visible range is 6 AM through midnight. Placement snaps to 15 minutes, the task estimate supplies the initial duration (one hour when unset), and date, start, duration, and the portion label are then editable independently. There is no auto-capture of progress, blocks delete themselves 48 hours after their scheduled end, and the task is untouched.

### Fitness

Fitness is fed nightly by a deliberately low-tech pipeline: you screen-record the Bevel iPhone app for 10 to 20 seconds and a backend ingestion and normalization job extracts at least calories in, out, and deficit and the nine muscle groups worked; the schemas are locked before the build. There is no standalone Fitness page; the normalized data stays available to the system. Sleep remains a manual habit until the iOS app unlocks HealthKit relay.

### LeetCode

LeetCode is manual logging against the NeetCode 150 curriculum: topic progress with real problem lists, its own streak and pool, and daily solve intensity. A curriculum problem is a stable record separate from its attempt history. Every solve or review appends a durable attempt with an editable date and the exact pasted solution source; repeating a problem never overwrites an earlier attempt or creates a duplicate problem. Distinct-solved progress counts each problem once, while attempt totals and daily intensity count every solve and review, and any attempt logged that day satisfies the streak. A synced mistakes log supports creating, editing, and deleting short notes of up to 2,000 characters, newest first. Chart treatment is still an open design area.

### Jobs

Board, Flow, and Browse are separate views. The board begins at To apply, then Applied, OA, Interview 1, Interview 2, Interview 3, and Offer or Rejected. Browse is the SimplifyJobs catalog, and a listing joins your pipeline only when explicitly added; there are no automatic pipeline imports. Search and additive AND filters cover hiring cycle, category, company, location, posted date, and added date, and view state survives navigation within the session.

Ingestion polls the structured `listings.json` source and deduplicates entries. The standing filters are: visible, open, non-hardware, at least one US location, and Fall 2026 or later when a cycle is specified, with unspecified cycles eligible. Revising the cycle cutoff is an open catalog-policy detail. Ingestion pages through all eligible listings and groups equivalent company, role, location, and cycle listings with an openings count.

Roles share one editable schema: company, role, location, posting link, hiring cycle, posting date, stage, applied date, OA due date, three interview dates, decision date, and applied resume version. Unset values stay blank, there is no generic role Notes field, and manual creation supports non-feed roles. Details use centered dialogs with directly editable dates.

Cross-column board drops and stage-menu moves open the role dialog as an unsaved draft with the destination stage and its date control first. Grouped Interviews and Decided drops require choosing the round or outcome; Manor never assumes rejection. Dates stay unset until entered, **Cancel** leaves the stored role and stage history unchanged, and **Save** applies the stage and date edits together. Stage transitions persist, and board cards show the current meaningful update. Flow begins at Applied and derives the role's path from history; a backwards stage correction removes the undone hops from the displayed path so repeated dragging can't inflate progress. Chart values are exposed to assistive technology. Resume PDFs are private cloud files with named versions; roles reference the version used, and purging one role never deletes a shared file.

### Notes

Notes is a cloud-backed document workspace with protected browser-local drafts and queued saves. Pages keep folders, their hierarchy, favorites, recents, archive, Trash, full-text search, duplication, movement, Markdown import and export, and durable app-owned attachments. The Notion parity target concerns document editing; it doesn't extend Manor into Notion databases, shared workspaces, or general project management. Notes navigation and the note list collapse independently into slim rails, preserving the open editor and remembering each panel's visibility on the device.

The target is full Notion parity for note-taking fundamentals and rich content, including the editing UX: paragraphs, headings, lists (including document-local checkboxes), toggles, quotes, dividers, callouts, highlighted code, inline formatting and links, text and background colors, simple tables, images, audio, video, files, internal page mentions, equations, a live table of contents, web bookmarks, sandboxed embeds, and responsive column layouts. Document checkboxes don't create or synchronize Manor tasks. Image handling includes distinct captions and alt text, resizing, and cropping, and attachment insertion, replacement, and failure recovery are complete workflows.

Block selection, insertion, reordering, duplication, movement, conversion, slash commands, Markdown shortcuts, copy and paste, undo and redo, and contextual controls work consistently across supported content, matching Notion's editing behavior and control anatomy in Manor's visual language. The [redesign report](REDESIGN-REPORT.md#notion) records the evidence and remaining coverage; screenshots alone don't prove parity. In-document tabs are included with editable content inside each tab. Persistent accept-or-reject suggestions follow the [authority rules](#authority-and-tool-coverage). Codex can create artifacts and insert them with ordinary content and media tools; an embedded AI slide generator is outside the first web release.

Notes expose seven days of meaningful document versions through a version-history UI, separate from tool-only action history. Restoring a version creates a new current revision while preserving newer work in retained history, and purging a note purges its versions and suggestions.

Documents preserve their full native structure. Markdown is an explicitly lossy interchange format: math uses LaTeX, the live contents block becomes anchor links, bookmarks and embeds become ordinary links, and columns become sequential sections. Unsupported conversions disclose their losses instead of dropping content. Autosave failures stay visible and retryable. Find-in-note highlights matches with next and previous navigation without changing contents. Moving a page to Trash includes its subpages, with recovery and purge following the [retention policy](#recovery-and-retention). The note list is a multi-select list: Shift-click selects a range, Cmd or Ctrl-click toggles a note, Cmd or Ctrl+A selects the visible list, Escape clears, Delete moves the selection to Trash (or deletes permanently inside Trash), and a right-click menu carries the same actions. A move to Trash shows a toast with **Undo** while it can still be reversed in place. Concurrent edits to a note from two devices or an agent merge by block when they touch different blocks; only edits to the same block ask you to compare versions. Editor structure and persistence are in the architecture's [Notes drafts and editing](ARCHITECTURE.md#notes-drafts-and-editing) section.

### Knowledge base

X bookmarks and Codex-supplied captures share the knowledge base. Codex or you supply source links, screenshots or media, and processed content, and Manor saves it for retrieval without a mandatory normalization-model pass. Existing capture assets remain available, and embedding captured content is separate background work.

X bookmarks (not likes) are ingested periodically, including linked article content where available, in source bookmark order. Captures show meaningful pending and failed states with retry. Text and semantic retrieval are available through Manor tools. The page uses compact rows with no read or unread state, and capture screenshots need not appear in the list. Ingestion and model boundaries are in the architecture's [background work](ARCHITECTURE.md#background-work-and-integrations) section.

## Surfaces

- **Home** is the tasks kanban plus the Today timeline. Events, scratch blocks, the now-line, and scheduling live here; habit logging lives on Habits.
- **Sidebar.** Docked by default with one toggle and no pin concept. Collapsed mode reveals a floating overlay on left-edge hover and dismisses on leave; toggling docks it, and the choice persists. It navigates to the modules and the dedicated weekly reviews.
- **Product surfaces.** Gated signup, login, onboarding, Settings, account and integration management, appearance preferences, recovery and Trash, and designed empty states. There is no desktop hotkey or permission onboarding, no embedded-agent settings, and no Activity page.
- **Object details** are centered dialogs. Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited; primary page layouts, the sidebar, inline popovers, menus, and tooltips are unaffected.
- **iOS, later.** A native companion, primarily for notifications, with capture, widgets, and HealthKit relay scoped after the web work.

## Design system

Mixpanel is the aesthetic baseline and Notion is the Notes editing and contextual-control reference, based on the supplied Mobbin flows. The paper-and-ink identity is retired. The high-level layout stays, including the Home kanban plus a single-column calendar timeline, while Mood and Focus and the module history views are fully redesigned. Light and dark modes are both deliberately designed. The [design charter](DESIGN.md) owns the design rules and the [redesign report](REDESIGN-REPORT.md) owns reference evidence and proposals. There are no mascots or characters.

The application mock data is the single canonical showroom story. Signed-in surfaces use real account data, including honest empty states, and never substitute showroom records.

## Delivery priorities

**P0: a correct, complete web foundation.** Account gating and isolation; authoritative data and shared operations; preservation and migration of existing data; robust remote MCP coverage; cache consistency and conflict handling; offline note protection; file storage; seven-day Trash and purge; saved time zone; existing module mechanics; daily synthesis; durable tool-accessible action history. The retained UI is connected to the web foundation before release.

**P1: synthesis and refinement.** Scheduled weekly reviews with their dedicated surface, richer retrieval and analysis over retained history, and the Mobbin-informed UI redesign. Essential tool reads, writes, search, and useful bulk operations are P0; P1 is not a reason to ship a narrow toolset. Final design sequencing runs alongside the foundation once data contracts are stable.

This is planned delivery scope, not a claim that every feature exists. Technical acceptance and migration checks are in the architecture's [migration and verification](ARCHITECTURE.md#migration-and-verification) section.

## Non-goals and deferred work

**Non-goals:** Electron support; an embedded conversational or voice agent; recreating a native summon UI; unrestricted agent database access; a Journal or any private encrypted writing surface; a user-facing action log; multi-user collaboration, teams, or sharing; a general-purpose Notion competitor; a standalone calendar workspace; mascots or characters.

**Deferred:** native iOS and proactive notification delivery; finance and media modules; additional jobs sources; Google Calendar push updates and iCloud CalDAV; fitness ingestion until its schemas are agreed. Notes cloud storage is part of the web foundation, not deferred.

## Decision log

The following table is the concise record of decisions that govern the current target; superseded desktop requirements and implementation-fix chronology were removed. Current behavior is specified in the sections earlier on this page.

| Date | Decision |
|---|---|
| 2026-08-19 | Manor product and core tracker mechanics selected (product thesis, positioning, principles, streak system). |
| 2026-08-22 | Merged task workspace, attempt-based LeetCode history, rich Notes, and centered object details established (modules, surfaces). |
| 2026-08-23 | Standalone calendar workspace removed (tasks). |
| 2026-08-26 | Manual habit freezes and non-destructive retirement selected; Jobs Browse requires explicit pipeline addition (streak system, jobs). |
| 2026-08-27 | Monthly freeze pool starts full (streak system). |
| 2026-08-29 | Editable contexts, LeetCode mistakes log, and note finding and lifecycle refinements established (modules). |
| 2026-09-09 | Full web migration, Codex as interactive agent, and UI redesign chosen (platform, agent tools, design system); technical design is owned by the architecture page. |
| 2026-09-09 | Signup gate, direct requested operations, saved time zone, seven-day Trash, recurrence occurrences, daily synthesis, and private tool-accessible history resolved (platform, agent tools, modules). |
| 2026-09-09 | Final follow-up: Notes included in Trash; structural history survives content purge; dedicated weekly-review surface; voice and typed Codex debriefs. |
| 2026-09-09 | Automatic cancellation of sign-out with unsynced drafts and daily database and file backups selected (platform, agent tools). |
| 2026-09-09 | Mixpanel aesthetic, Notion Notes editing parity, retirement of paper and ink styling, and intentional light and dark modes selected; high-level layouts retained (notes, design system). |
| 2026-09-09 | Google-only gated signup, remote MCP, scheduled ChatGPT weekly reviews, persistent optional Notes suggestions, document tabs, seven-day Notes versions, and recurrence edit scope resolved (platform, agent tools, modules). |
| 2026-09-10 | The last unused context can be removed; task references remain protected (tasks). |
| 2026-09-10 | Mood and focus history allows ratings to be added or corrected for any past day; quick capture keeps its today-and-yesterday window (mood and focus). |
| 2026-09-11 | Google Calendar sync runs every minute with a hard limit of twelve calendars across all connected Google accounts; over-limit connections are rejected and later over-limit calendars are skipped without interrupting sync (integration boundary). |
| 2026-09-12 | Journal removed entirely: no encrypted writing surface, package, schema, or tooling (non-goals). |
| 2026-09-13 | WebMCP removed; remote MCP is the only agent transport, with no live-browser context, selection, or presentation tools (platform, agent tools). |
| 2026-09-13 | Day-and-night theme preference: light from 6 AM to 6 PM local time, dark otherwise (design system). |
| 2026-09-13 | Permanent deletion from Trash as a user-only action that purges at once; multi-select note list with batch Trash, restore, and permanent delete; block-level merge of concurrent note edits, with compare-versions reserved for same-block conflicts (notes, recovery and retention). |

## Remaining product detail

The first-release decisions are settled. Detailed component and chart design follows the design charter without another broad product round. The jobs catalog keeps its standing filters until explicitly revised. Custom tracker creation, Bevel ingestion, native iOS notifications, and HealthKit relay stay deferred and don't block the first web release. Remaining technical configuration and verification are tracked only in the architecture's [remaining technical work](ARCHITECTURE.md#remaining-technical-work) section.
