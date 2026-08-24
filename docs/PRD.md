# Manor PRD

_Last updated: 2026-08-24_

## 1. Product Thesis

Manor is a personal productivity OS: habit, mood, focus, fitness, LeetCode, and job-search tracking, a merged task system, markdown notes, an X bookmarks knowledge base, an encrypted journal, and a voice agent (Alfred) that can act on the user's behalf.

It replaces user's legacy Notion system ("the legacy Notion system", documented in `NOTION-REPORT.md`), whose §5 catalog of workarounds — single-row formula-host databases, a hand-maintained join row, pre-linked month buckets, styled-text pseudo-widgets — is the negative space this product is designed against. Manor's core bet: when logging is frictionless, streaks are first-class, and an agent absorbs the work-about-work, a personal system gets *used* instead of maintained.

Manor is personal software with a product bar: although it has one primary user, it is built as a proper product anyone could adopt — real sign-in and onboarding, settings, empty states, cloud sync — not a hardcoded dashboard.

## 2. Positioning

Manor is not purely:

- a Notion clone, because structured tracking, streak mechanics, and an acting agent are the core, and documents are second-class
- a habit tracker, because tasks, knowledge, and job pipeline live in the same modular system
- a chat-AI wrapper, because Alfred is voice-only, tool-wielding, and scoped by an explicit authority model

It is best understood as a tailored, unbloated personal agent-OS with a dashboard: composable modules over one data layer, with the agent as a first-class user of the same system.

**Modularity model (Vim-like):** a **module** is a tracker/feature unit that can be added, swapped, or removed. Simple trackers are **config-defined** (creatable in-app: name, fields, cadence, streak participation, card type); complex modules (Jobs, LeetCode, Fitness) are **code-defined**. Mood and Focus are the reference config-defined modules.

## 3. Product Principles

1. **Frictionless logging above all.** the legacy Notion system's multi-tap flows died; every Manor flow must be one-tap or one-utterance. Voice logging is a first-class path.
2. **Work-about-work ≈ zero.** No manual syncing, filter rotation, or plumbing upkeep, ever.
3. **Streaks are load-bearing** (§6). Motivation and accountability are features, not decoration.
4. **AI insight over long-term data** via background analysis (§5), surfaced as briefings, never as interruptions.
5. **Consistency by design, not backfill.** Backfill is limited to one day everywhere; the system nudges same-day logging.
6. **Emotional design and great UX outrank minimalist elegance.** The right treatment is judged per interface and per flow. Celebration and urgency are designed states, executed with restraint.
7. **Space efficiency.** Content runs edge-to-edge; padded-card page framing and "page inside a page" layouts are failures (see AGENTS.md anti-patterns).
8. **Memory discipline within Electron's reality.** Study and apply the optimization practices of the serious Electron apps: few processes, lazy windows, virtualized lists, V8 heap hygiene.

## 4. Platform and Stack

- **Electron on macOS ships first.** The iOS app is definitely planned and begins only after the Mac app is finished (separate stack, chosen then; Electron has no iOS target). Decision record: native Swift/SwiftUI was prototyped, evaluated, and rejected in favor of web-stack velocity; do not re-litigate (also rejected: Tauri).
- **Backend: Supabase** (Postgres, Auth, Edge Functions, Realtime, pgvector) via `supabase-js`. Server-side compute is embraced — scrapers, cron, webhooks, and background AI jobs run in Edge Functions.
- **Sync posture: online-required with a local read cache** (SQLite in the main process). One carve-out: the Notes module gets a local write-queue so lecture notes survive dead wifi; quick habit check-offs may share it.
- **Models:** `gpt-realtime-2.1` for all voice (WebRTC from the renderer, official JS SDK); `GPT-5.6-terra` for everything non-voice, reasoning effort medium or higher, always; `text-embedding-3-small` (1536 dims, fits pgvector HNSW) for embeddings.
- **Calendar sync (Today timeline feed only):** direct Google Calendar API with `syncToken` incremental polling (~60s freshness) feeds the Home Today timeline; `events.watch` push via an Edge Function webhook is the later upgrade. The standalone calendar workspace was removed 2026-08-23.
- **macOS surfaces from Electron:** the global summon panel is a frameless `type: 'panel'` non-activating window + `globalShortcut` (the verified Notion/Claude-Desktop/1Password pattern). Touch ID via `systemPreferences.promptTouchID`; Keychain-backed secrets via `safeStorage`. OS desktop widgets are out of scope (impossible from Electron; widgets are an iOS-phase, native concern).

## 5. Alfred (the Agent)

One persona, voice-only (the user never types to Alfred), three mechanisms:

1. **Voice sessions — ephemeral.** Summoned by one global hotkey (⌥Space): outside Manor it raises the summon panel over any app or full-screen Space; inside Manor it opens the Alfred modal. Mic is hot on summon. A WebRTC session starts with an injected memory preamble, auto-minimizes when the exchange ends, and dies on dismissal or the 60-minute API cap. Nothing runs between sessions.
2. **Background jobs — scheduled terra runs** (server-side): nightly insight pass (cross-module correlations), weekly review, jobs-feed digest, X ingestion, hygiene checks. Jobs write findings; they never speak. The **morning briefing** is prepared and waiting behind a badge — it never auto-pops.
3. **Shared memory and audit.** A Supabase store (facts, session summaries, embeddings) gives continuity; a visible audit trail records every agent action, with undo on recent entries.

**Escalation:** the realtime model handles conversation and simple tools; cognitively heavy requests route to terra via the supervisor-tool pattern (say a filler line, call `consult`, rephrase the answer speech-first). Insight queries and document Q&A are terra calls by construction.

**Authority:** full read/write across all modules **except the Journal (zero access, architectural — §7.9)**. Logging, check-offs, and creation need no confirmation; historical edits, deletions, and anything external require a verbal confirm-back (flexible phrasing).

**Presence: the thinking orb.** No mascots or characters, ever (a Rive-character direction was explored and killed). Alfred renders as an animated particle-sphere orb (reference: orbs.jakubantalik.com) with idle/listening/thinking states, inline beside status text and scaled up in the modal.

**Current local surface boundary.** The Electron build implements the real summon lifecycle before cloud voice is connected: one registered ⌥Space shortcut, a centered in-app modal, a single non-activating global panel across Spaces, immediate local microphone capture with live orb energy, mute/end/error states, cleanup on every dismissal, and a local completion glance for Tasks, Habits, Mood & Focus, and LeetCode. The glance links to those modules and excludes Journal by type and architecture. No transcript or simulated response is shown. The later cloud step adds the ephemeral Realtime WebRTC transport and tool loop without changing this local surface contract; client authentication must use a server-minted ephemeral secret rather than exposing a standard API key.

**Summon panel contract:** "today's completion at a glance" has a locked, permanent spot in the panel; remaining contents are design-phase decisions. The panel replaced both the earlier notch-UI and menu-bar-dropdown concepts (retired; do not resurrect).

## 6. Streak System (Duolingo-derived, adapted)

- **Per-habit streaks.** No single global streak.
- **Perfect day:** every *active* habit completed (paused habits excluded; LeetCode excluded). Perfect days are the only way to earn freezes.
- **Freeze pool:** a shared monthly pool sized ≈ the number of active habits. Freezes **auto-apply** to whichever habit misses a day, capped at one per habit per day.
- **Earn-Back:** when a streak breaks with an empty pool, two clean days within 48 hours restore it — once per habit per month. The only recovery path.
- **Gold state:** seven freeze-free days per habit. Communicated by design (gilded flame/number), never by text chips.
- **Habit shape:** binary, or quantized to exactly 0/25/50/75/100% (decision-paralysis guard — no finer granularity). Habits can be added, retired, or paused any time; a mid-month habit starts at streak 0 and immediately counts toward perfect day.
- **LeetCode is separate:** its own streak (≥1 problem logged that day), its own pool of 5/month, no Earn-Back, excluded from perfect day.
- **Backfill:** one day, everywhere; same-day edits allowed.
- **Urgency surfaces (macOS):** an evening "log your day" batch nudge (matches the user's real night-logging behavior — never per-habit nagging), task reminders as a distinct notification class, at-risk emphasis on the habit surface itself. iOS later adds Duolingo-style lock/home widgets.

## 7. Modules (v1)

### 7.1 Habits
Daily check-off and streak home (check-off lives here, not on Home). Full-fidelity views: per-habit month grid, week strips, best/current streaks, freeze pool as a first-class object. Add/pause/retire flows. Freeze-management mechanics UI is still an open design area.

### 7.2 Mood & Focus (reference config-defined trackers)
One date-keyed record per day with two independently loggable signals: Mood (Great/Good/Neutral/Bad/Awful) and Focus (Locked In/High/Medium/Low/Locked Out/Resting). Either signal saves in one tap; a missing signal remains distinct from `Resting`. Typed context is not available on this page. Context can be attached only as a terra summary from a combined **voice debrief** with Alfred. Historical typed notes remain readable with their original provenance, but no new manual context can be written. Today and yesterday are directly editable; older records remain read-only. History supports navigable months, a compact daily record, and a shared longer-range view of how Mood and Focus move together. Debrief content is AI-visible by design (deliberate contrast with the Journal).

### 7.3 Tasks
- **One merged task system** (the legacy Notion system's academic/personal split is dead) with contexts (Uni, Personal, Leetcode, Apps, Hackathons). Contexts carry a user-chosen icon and semantic color that persist anywhere the context is shown. Fields: status, due, context, difficulty (time-estimate), priority, recurrence with full rule granularity (specific weekdays, intervals, end dates).
- **Due buckets are computed** (Overdue/Today/Tomorrow/This Week) — never a hand-maintained select. The Home kanban groups by bucket, Notion-board DNA.
- **Weekly and Master task views.** Weekly is the computed due-bucket board, ordered by exact due date and then High → Medium → Low priority. Master is the longer-horizon task table with title search, a fixed due-first ordering, and an additive property-filter builder for Context, Status, Priority, and Due date. Applied filters clear in one action without deleting saved views; filter sets can be named and saved as reusable views. Overdue has no creation path; Today and Tomorrow create on their exact date; This Week requires an exact date within the remaining seven-day board horizon before creation. New-task Context begins unset and must be selected or created. Dragging between exact-date buckets changes the due date; dropping onto This Week opens the due-date editor because a range is not a date. Single click opens centered task detail with one directly editable title; double-click, right-click, or Shift+F10 opens a compact task action menu with detail, completion, and deletion actions.
- **No calendar workspace (removed 2026-08-23).** Manor does not ship its own calendar surface; Notion Calendar (the app) covers calendaring. Day events from connected calendars appear only in the Home Today timeline, and scratch blocks remain Manor-only Home objects.
- **Today timeline is direct-manipulation paper:** scratch blocks (sticky notes) drag vertically to reschedule (15-minute snap), and dragging on empty timeline creates a new sticky over that range and opens its dialog. Stickies may be freestanding notes (`taskId: null`) or time-block a task; freestanding note text lives in `portion`.
- **Scratch blocks:** tasks (or parts of tasks) drag onto the Today or Tomorrow schedule as Manor-only time blocks — never written to Google. The visible scheduling range is 6 AM through midnight. Placement snaps to 15 minutes; the task estimate supplies the initial duration (one hour when unset), then date, start, duration, and the portion label can be edited independently. No auto-capture of progress (plans are scratch); blocks self-delete 48 hours after their scheduled end; the task is untouched.

### 7.4 Fitness
Fed nightly by a deliberately low-tech pipeline: the user screen-records the Bevel iPhone app (10–20s) and Manor runs a terra **ingestion + normalization job** (schemas to be locked before build). Minimum outputs: calories in/out/deficit and the 9 muscle groups worked. There is no standalone Fitness page; the normalized data remains available to the system. Sleep remains a manual habit until the iOS app unlocks HealthKit relay.

### 7.5 LeetCode
Manual logging against the Neetcode 150 curriculum: topic progress with real problem lists, own streak and pool (§6), daily solve intensity. A curriculum problem is a stable record, separate from its attempt history. Every solve or review appends a durable attempt with an editable date and the exact pasted solution source; repeating a problem never overwrites an earlier attempt or creates a duplicate problem. Distinct-solved progress counts each problem once, while attempt totals and daily intensity count every solve/review. Any attempt logged that day satisfies the LeetCode streak day. Plotting/chart treatment is still an open design area.

### 7.6 Jobs
Two lists: **To apply** (parsed daily from the SimplifyJobs `listings.json` on the `dev` branch via an ETag-polled Edge Function; filter `active && is_visible`; applied/seen auto-hide) and the **Pipeline** (Applied → OA → Interview 1 → Interview 2 → Interview 3 → Offer/Rejected). Every role uses one property schema at every stage: company, role, location, posting link, date posted, stage, applied date, OA due date, three interview dates, and decision date; unset values remain blank. The generic Notes field is removed. Manual add collects company, role, posting link, location, a user-selected date posted, and an initial stage. Role details open in a centered modal and every date is directly editable. Roles and append-only stage transitions persist locally through typed SQLite/IPC. Board cards show only the current meaningful update. The Pipeline toggles between a drag-and-drop board and a responsive Sankey flow derived from persisted transition history. The flow begins at Applied, omits the To apply queue, and exposes its values to assistive technology without a separate visible transition table. No push notifications. Non-Simplify roles can be added manually; other scraped sources are a later expansion.

### 7.7 Notes
Notes is a local-first document workspace backed by typed SQLite/IPC. Pages support folders, nested page hierarchy, favorites, recents, archive, Trash, full-text search, duplication, movement, Markdown import/export, and durable app-owned attachments. Native BlockNote JSON is the lossless source format; Markdown is an explicitly lossy interchange format. The editor covers paragraphs, three heading levels, bulleted and numbered lists, toggles, quotes, dividers, callouts, code with language-aware highlighting, inline formatting and links, text/background colors, tables, images, audio, video, files, block selection/reordering, slash commands, Markdown shortcuts, internal page mentions, inline and block equations, a live heading-based table of contents, web bookmarks, sandboxed web embeds, and resizable two-column document layouts that stack responsively. Markdown import recognizes inline and block LaTeX; export converts live contents to anchor links, bookmark/embed blocks to ordinary links, and columns to sequential sections because Markdown has no lossless equivalents for those layouts. Checklists, databases, and timeline views are task/project-management features and do not belong in Notes. Autosave failures remain visible and retryable; cloud sync and embeddings remain later backend work. **AFFiNE and BlockSuite remain the interaction reference; BlockNote is the embedded editor engine selected for the Electron implementation.**

### 7.8 X Bookmarks
Bookmarks only (not likes), ingested every ~15–30 minutes by Edge Function cron (X pay-per-use "Owned Reads" at $0.001/post with daily dedup makes this ≈ free; OAuth2+PKCE user context). A bookmarked post's linked article is captured into the same entry; a bookmarked bare article is its own entry. Everything embedded for semantic retrieval; primary interface is asking Alfred. Compact list surface; no read/unread state.

### 7.9 Journal
E2E encrypted, Touch ID/password locked. Random master key in Keychain; one-time recovery key, changeable by entering the current key. Server stores ciphertext only. **Zero AI access of any kind — no embeddings, no insight pass; signal loss accepted.** The one module Alfred cannot see, architecturally.

## 8. Surfaces

- **Home = the tasks kanban + the Today timeline. Nothing else.** The Today panel is an hour-axis timeline (events, scratch blocks, now-line, drop-to-block). Habits, streak chips, and agent strips do not live on Home.
- **Sidebar:** Notion-exact model. Docked by default; one toggle (no pin concept); collapsed mode reveals a floating overlay on left-edge hover and dismisses on leave; clicking the toggle docks it; choice persists.
- **Proper-product surfaces:** sign-in + first-run onboarding (welcome, sign-in, calendar connect, habit picker, hotkey intro), Settings (account, connections, Alfred, notifications, appearance), designed empty states on every module.
- **Global summon panel** (§5) with the locked completion glance, voice controls, and thinking orb. Its renderer is shared with the centered in-app Alfred modal, while Electron owns which surface appears.
- **Object details:** every object/detail view opens in an appropriately sized centered modal. Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited. This does not change primary page layouts, the sidebar, inline popovers, menus, or tooltips.
- **iOS (later, native):** capture-first app, lock/home widgets (static timeline snapshots by OS design), HealthKit relay unlocking sleep auto-capture and richer fitness.

## 9. Design System

Direction: **Paper** — light, paper-white, editorial, violet-accented (tokens, typography roles, sound, and copy voice live in `DESIGN.md`, the binding design charter). The original heavy-cream **Atelier** surfaces were retired 2026-08-23: beige-dominant chrome hurt readability and made the app read inconsistently; the warm undertone survives only in near-white paper neutrals. Violet is the single interaction accent; mono type is restricted to code; the app-wide type floor is 12px. Dark mode was evaluated in hi-fi and **rejected**: harder element distinction, worse for productive work. Gamified-colorful (Duolingo-forward) was likewise rejected as too much for a life OS; Duolingo survives in mechanics, not in pixels. The design anti-patterns in `AGENTS.md` are hard rules. Structural reference apps: Notion (boards, property editing, sidebar), Notion Calendar/Cron (historical reference for the removed calendar workspace) — pulled as real flows via the Mobbin MCP.

## 10. Verified Technical Constraints

| Fact | Consequence |
|---|---|
| HealthKit is iPhone-only; Bevel and Zepp expose no APIs | Fitness arrives via the Bevel-clip ingestion; HealthKit relay waits for iOS |
| `gpt-realtime-2.1`: 60-min session cap, no resume; prompt caching favors a stable preamble | Ephemeral sessions + injected memory (§5) |
| Realtime supervisor-delegation and tool calling are documented first-class patterns | Terra escalation as designed |
| Electron `type:'panel'` + `globalShortcut` verifiably powers Notion/Claude/1Password summon panels | Summon panel architecture (§4) |
| Electron has no iOS target and no OS-widget capability | iOS is a separate later codebase; no desktop widgets |
| Google Calendar `syncToken` polling is quota-free at personal scale; push needs an HTTPS webhook | §4 calendar sync design (Today timeline feed) |
| X API is pay-per-use; Owned Reads $0.001/post with daily dedup; archives exclude bookmarks | §7.8 ingestion design |
| SimplifyJobs `listings.json` (`dev` branch) is the maintained structured source | Poll with ETag; never parse the README |
| pgvector HNSW ≤ 2000 dims | `text-embedding-3-small` @ 1536 |
| Duolingo research: auto-applied freezes raise retention; Earn-Back beats paid repair; gold/perfect states let flexibility and perfectionism coexist | Streak system (§6) |

## 11. Non-Goals and Deferred

**Non-goals:** multi-user collaboration, teams, sharing; a general-purpose Notion competitor; typed chat with Alfred; mascots/characters; OS desktop widgets; dark mode as the primary theme.

**Deferred, explicitly:** finance module (genuinely wanted, later); media tracking (cut); additional job sources; `events.watch` real-time calendar push; iCloud CalDAV; wake-word summoning; GPT-Live migration when its API ships; Notes cloud sync and embeddings; freeze-management UI mechanics; per-component design drill-downs (colors and chart language) — the declared next phase.

## 12. Decision Log

| Date | Decision |
|---|---|
| 2026-08-19 | Product mechanics locked over four brainstorm rounds; name **Manor** chosen |
| 2026-08-20 | Platform pivot: native Swift/SwiftUI prototypes evaluated and rejected → **Electron**; memory principle restated as Electron-discipline |
| 2026-08-20 | Notch UI and menu-bar dropdown retired → one **global summon panel**; completion glance locked into it |
| 2026-08-21 | Fitness reinstated in v1 via nightly Bevel-clip → terra ingestion |
| 2026-08-21 | Hi-fi direction: **Atelier** wins; dark mode and gamified-colorful rejected; design anti-patterns codified |
| 2026-08-21 | Agent character (Rive/Archie) killed → **thinking orb**; persona is voice-only |
| 2026-08-21 | Home reduced to kanban + Today timeline; habits logging moved to Habits; **Calendar became a workspace toggle**; sidebar = Notion-exact docked-default model |
| 2026-08-21 | Hi-fi Electron shell (`app/`) shipped: all v1 surfaces clickable on mock data |
| 2026-08-22 | Home task workspace semantics locked: Weekly + Master views; Master property filters can be saved and the visible sort control is omitted; Overdue is non-creatable, Today/Tomorrow creation uses exact dates, This Week creation requires an exact date, and new-task Context begins unset; task double-click opens reusable quick actions; exact-date bucket drops update due dates while This Week routes to the date editor; Today/Tomorrow scratch blocks schedule from 6 AM to midnight, snap to 15 minutes, inherit task estimate initially, remain independent from task progress, and delete 48h after scheduled end |
| 2026-08-22 | Home task presentation refined: contexts persist a chosen icon/color, difficulty uses semantic tones, Weekly ordering is due then priority, Master filters clear without affecting saved views, and task detail is centered with one editable title |
| 2026-08-22 | Standalone Fitness page removed; normalized fitness data remains available without a sidebar module surface |
| 2026-08-22 | Mood & Focus context is Alfred-only: the Daily page has no typed note path, new context mutations accept Alfred provenance only, and historical manual notes remain readable without destructive migration |
| 2026-08-22 | LeetCode problem identity separated from attempt history: repeat solves/reviews append dated, source-preserving attempts; distinct-solved progress counts problems once, while attempt totals, intensity, and streak days count every logged attempt |
| 2026-08-22 | Object and detail views are centered modal dialogs app-wide; side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited |
| 2026-08-22 | Jobs moved from mock-only state to typed local SQLite/IPC persistence with one consistent editable role schema, append-only stage-transition history, current-update-only board labels, and Board/Flow views; generic role Notes were removed |
| 2026-08-22 | Jobs refinement: custom clearable date controls replace native pickers, Stage sits with editable role properties, Flow begins at Applied with a hidden accessible summary, and the board owns its column scrolling |
| 2026-08-22 | Alfred's local surface contract resolved: ⌥Space opens the centered modal inside Manor or one non-activating panel outside; local microphone capture, mute/end/error cleanup, the thinking orb, and a Journal-excluding completion glance ship before the cloud Realtime transport |
| 2026-08-22 | Notes moved from the interim shell to a local-first BlockNote document workspace with lossless native block persistence, offline-safe app-owned attachments, hierarchy/search/lifecycle flows, visible autosave state, and lossy Markdown import/export; AFFiNE remains the interaction reference while cloud sync and embeddings remain deferred |
| 2026-08-22 | Notes document parity expanded with equations, live heading contents, web bookmark/embed blocks, and a project-owned resizable column layout; the GPL/commercial BlockNote column add-on was rejected in favor of code with no new licensing obligation |
| 2026-08-22 | Calendar moved from the interim shell to a local-first FullCalendar workspace with persisted calendars, occurrence-scoped recurrence exceptions, view settings, commands, Notes attachments, creation/editing, drag/resize, and linked Home/Jobs overlays; Google/Notion sync, invitations, scheduling links, shared availability, provider conferencing, and menu-bar integrations remain honest cloud-only deferments |
| 2026-08-23 | Design direction revised: **Atelier → Paper.** Cream/beige surfaces retired for white content + near-white paper chrome; violet becomes the single interaction accent (replacing scattered slate-blue/olive accents); app-wide type floor raised to 12px (11px gutter exception); mono type restricted to code; one shared recipe per UI pattern; tasteful completion sounds added. Calendar rebuilt to Notion Calendar anatomy: true 7-day week (14-day continuous view and horizontal grid scrolling removed), white rail, tinted events with left accent bars, red today/now markers, Notion-style property-row event dialog |
| 2026-08-23 | Calendar event editor: centered dialog replaced by an **event-anchored popover** (Notion Calendar parity; centered fallback only without an anchor) — recorded in DESIGN.md as the one exception to the centered-dialog rule. Trackpad horizontal panning navigates the grid (day view slides by day; week/month step a period); the grid itself never scrolls horizontally |
| 2026-08-23 | **Paper, second pass — "the printed page you write on."** Faint app-wide feTurbulence grain (the stock); EB Garamond retired and **Shantell Sans Variable** becomes the hand face owning all display roles (greetings, page titles, empty states, celebrations, Journal dates); rough ink marks for rare moments (hand-drawn checkbox stroke, perfect-day circle, empty-state squiggle); scratch blocks render as sticky notes (the one sanctioned skeuomorph). Handwriting never renders data; Journal body stays in the print face |
| 2026-08-23 | **Analog, second order.** Paper stock switched to the Paper Shaders PaperTexture overlay (tuned for readability); the hand voice expanded to buttons, view toggles, kanban pills, and section titles with squiggle underlines and sketched empty-state rings; scratch blocks became draggable sticky notes with drag-on-timeline creation, backed by a nullable `taskId` (freestanding notes) and a scratch_blocks migration |
| 2026-08-23 | Feedback pass on the analog system: habit "gold" streak state renders violet (achievement = brand, not gold); tiled squiggle underlines retired (broken-dash look); Notes code blocks map shiki dual-theme variables to github-light (were unreadable); Mood & Focus capture redesigned from scratch (hand-face prompts + floating tinted chips with drawn ink-ring selection, bordered option grid deleted); sticky-note dialog stripped of icon and mechanics caption; sticky click-to-open fixed (pointer capture ate the click); kanban task cards restyled as white note cards (dog-ear, tilt); LeetCode rail replaced by a 7-day attempt-count status row; Jobs Sankey sized from data so it always fits its box |
| 2026-08-24 | Second feedback pass, delegated: sticky-note dialog reduced to Starts/Duration/Note; task Duplicate action (card menu + detail dialog); New-task due-date bug fixed (explicit picker choice wins over bucket default); Master view gains a "By context" grouping toggle (context headers, Context column removed); kanban dog-ear made clearly visible (two-tone cut + flap); remaining Habits gold/amber and misused frozen-blue partial states → violet; Today timeline now-line → violet; LeetCode rail v2: labeled per-day bars ("Mon, Aug 18" … "Today"); last non-code mono removed and Mood & Focus record chips de-slopped (sentence case, no fake-mono tracking) |
| 2026-08-23 | **Calendar workspace removed entirely** (page, Workspace↔Calendar toggle, FullCalendar dependency, calendar store/IPC/shared model). Notion Calendar the app covers calendaring; Manor keeps only the Home Today timeline's day-event feed (mock calendars/events in mock.ts) plus the Google Calendar connection surfaces in Settings and onboarding that feed it |

## 13. Open Questions

- Freeze-management mechanics UI; chart language; per-component color system.
- Config-defined tracker field-type catalog; jobs standing filters; task-reminder semantics.
- Bevel-clip ingestion schemas (to be locked before build).
- iOS app scope and stack (decided when the Mac app is finished).
