# Manor PRD

_Last updated: 2026-08-21_

## 1. Product Thesis

Manor is a personal productivity OS: habit, mood, focus, fitness, LeetCode, and job-search tracking, a merged task system with a first-class calendar, markdown notes, an X bookmarks knowledge base, an encrypted journal, and a voice agent (Alfred) that can act on the user's behalf.

It replaces user's legacy Notion system ("the legacy Notion system", documented in `NOTION-REPORT.md`), whose §5 catalog of workarounds — single-row formula-host databases, a hand-maintained join row, pre-linked month buckets, styled-text pseudo-widgets — is the negative space this product is designed against. Manor's core bet: when logging is frictionless, streaks are first-class, and an agent absorbs the work-about-work, a personal system gets *used* instead of maintained.

Manor is personal software with a product bar: although it has one primary user, it is built as a proper product anyone could adopt — real sign-in and onboarding, settings, empty states, cloud sync — not a hardcoded dashboard.

## 2. Positioning

Manor is not purely:

- a Notion clone, because structured tracking, streak mechanics, and an acting agent are the core, and documents are second-class
- a habit tracker, because tasks, calendar, knowledge, and job pipeline live in the same modular system
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
- **Calendar sync:** direct Google Calendar API with `syncToken` incremental polling (~60s freshness); `events.watch` push via an Edge Function webhook is the later upgrade; Apple Calendar via CalDAV if needed later.
- **macOS surfaces from Electron:** the global summon panel is a frameless `type: 'panel'` non-activating window + `globalShortcut` (the verified Notion/Claude-Desktop/1Password pattern). Touch ID via `systemPreferences.promptTouchID`; Keychain-backed secrets via `safeStorage`. OS desktop widgets are out of scope (impossible from Electron; widgets are an iOS-phase, native concern).

## 5. Alfred (the Agent)

One persona, voice-only (the user never types to Alfred), three mechanisms:

1. **Voice sessions — ephemeral.** Summoned by one global hotkey (⌥Space): outside Manor it raises the summon panel over any app or full-screen Space; inside Manor it opens the Alfred modal. Mic is hot on summon. A WebRTC session starts with an injected memory preamble, auto-minimizes when the exchange ends, and dies on dismissal or the 60-minute API cap. Nothing runs between sessions.
2. **Background jobs — scheduled terra runs** (server-side): nightly insight pass (cross-module correlations), weekly review, jobs-feed digest, X ingestion, hygiene checks. Jobs write findings; they never speak. The **morning briefing** is prepared and waiting behind a badge — it never auto-pops.
3. **Shared memory and audit.** A Supabase store (facts, session summaries, embeddings) gives continuity; a visible audit trail records every agent action, with undo on recent entries.

**Escalation:** the realtime model handles conversation and simple tools; cognitively heavy requests route to terra via the supervisor-tool pattern (say a filler line, call `consult`, rephrase the answer speech-first). Insight queries and document Q&A are terra calls by construction.

**Authority:** full read/write across all modules **except the Journal (zero access, architectural — §7.9)**. Logging, check-offs, and creation need no confirmation; historical edits, deletions, and anything external require a verbal confirm-back (flexible phrasing).

**Presence: the thinking orb.** No mascots or characters, ever (a Rive-character direction was explored and killed). Alfred renders as an animated particle-sphere orb (reference: orbs.jakubantalik.com) with idle/listening/thinking states, inline beside status text and scaled up in the modal.

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
One entry each per day, logged any time: Mood (Great/Good/Neutral/Bad/Awful) and Focus (Locked In/High/Medium/Low/Locked Out/Resting). Loggable solo in one tap, or via a single combined **voice debrief** with Alfred that fills both and attaches a terra-summarized note. Debrief content is AI-visible by design (deliberate contrast with the Journal).

### 7.3 Tasks and Calendar
- **One merged task system** (the legacy Notion system's academic/personal split is dead) with contexts (Uni, Personal, Leetcode, Apps, Hackathons). Fields: status, due, context, difficulty (time-estimate), priority, recurrence with full rule granularity (specific weekdays, intervals, end dates).
- **Due buckets are computed** (Overdue/Today/Tomorrow/This Week) — never a hand-maintained select. The Home kanban groups by bucket, Notion-board DNA.
- **Calendar is a workspace**, not a sidebar tab: a top-bar toggle switches Workspace ↔ Calendar (Notion ↔ Notion Calendar model). Full Cron/Notion-Calendar anatomy, edge-to-edge.
- **Scratch blocks:** tasks (or halves of tasks) drag onto the day as Manor-only time blocks — never written to Google. No auto-capture of progress (plans are scratch); blocks self-delete 24–48h after their scheduled end; the task is untouched.

### 7.4 Fitness
Fed nightly by a deliberately low-tech pipeline: the user screen-records the Bevel iPhone app (10–20s) and Manor runs a terra **ingestion + normalization job** (schemas to be locked before build). Minimum outputs: calories in/out/deficit and the 9 muscle groups worked. The page is a read-only dashboard; nothing is hand-logged. Sleep remains a manual habit until the iOS app unlocks HealthKit relay.

### 7.5 LeetCode
Manual logging against the Neetcode 150 curriculum: topic progress with real problem lists, own streak and pool (§6), daily solve intensity. Plotting/chart treatment is still an open design area.

### 7.6 Jobs
Two lists: **To apply** (parsed daily from the SimplifyJobs `listings.json` on the `dev` branch via an ETag-polled Edge Function; filter `active && is_visible`; applied/seen auto-hide) and the **Pipeline** (Applied → OA → Interview 1–3 → Offer/Rejected) with drag-and-drop stage moves, a per-role detail peek (stage, dates, link, notes — the Excel workflow, absorbed), and the Sankey-style funnel. No push notifications. Manual add for non-Simplify roles; other scraped sources are a later expansion.

### 7.7 Notes
Second-class but real: markdown with first-class code blocks, image/diagram attachments, folders; agent-readable and embedded for retrieval; local write-queue for offline capture. The long-term editor bar is Notion-level blocks — **AFFiNE (OSS) is the flagged reference/basis** for that future round; the current shell editor is explicitly interim.

### 7.8 X Bookmarks
Bookmarks only (not likes), ingested every ~15–30 minutes by Edge Function cron (X pay-per-use "Owned Reads" at $0.001/post with daily dedup makes this ≈ free; OAuth2+PKCE user context). A bookmarked post's linked article is captured into the same entry; a bookmarked bare article is its own entry. Everything embedded for semantic retrieval; primary interface is asking Alfred. Compact list surface; no read/unread state.

### 7.9 Journal
E2E encrypted, Touch ID/password locked. Random master key in Keychain; one-time recovery key, changeable by entering the current key. Server stores ciphertext only. **Zero AI access of any kind — no embeddings, no insight pass; signal loss accepted.** The one module Alfred cannot see, architecturally.

## 8. Surfaces

- **Home = the tasks kanban + the Today timeline. Nothing else.** The Today panel is an hour-axis timeline (events, scratch blocks, now-line, drop-to-block). Habits, streak chips, and agent strips do not live on Home.
- **Sidebar:** Notion-exact model. Docked by default; one toggle (no pin concept); collapsed mode reveals a floating overlay on left-edge hover and dismisses on leave; clicking the toggle docks it; choice persists.
- **Proper-product surfaces:** sign-in + first-run onboarding (welcome, sign-in, calendar connect, habit picker, hotkey intro), Settings (account, connections, Alfred, notifications, appearance), designed empty states on every module.
- **Global summon panel** (§5) with the locked completion glance.
- **iOS (later, native):** capture-first app, lock/home widgets (static timeline snapshots by OS design), HealthKit relay unlocking sleep auto-capture and richer fitness.

## 9. Design System

Direction: **Atelier** — light, warm-canvas, editorial (tokens, typography roles, and copy voice live in `DESIGN.md`, the binding design charter). Dark mode was evaluated in hi-fi and **rejected**: harder element distinction, worse for productive work. Gamified-colorful (Duolingo-forward) was likewise rejected as too much for a life OS; Duolingo survives in mechanics, not in pixels. The design anti-patterns in `AGENTS.md` are hard rules. Structural reference apps: Notion (boards, side peeks, sidebar), Notion Calendar/Cron, Obvious (agent-beside-artifacts workspace) — pulled as real flows via the Mobbin MCP.

## 10. Verified Technical Constraints

| Fact | Consequence |
|---|---|
| HealthKit is iPhone-only; Bevel and Zepp expose no APIs | Fitness arrives via the Bevel-clip ingestion; HealthKit relay waits for iOS |
| `gpt-realtime-2.1`: 60-min session cap, no resume; prompt caching favors a stable preamble | Ephemeral sessions + injected memory (§5) |
| Realtime supervisor-delegation and tool calling are documented first-class patterns | Terra escalation as designed |
| Electron `type:'panel'` + `globalShortcut` verifiably powers Notion/Claude/1Password summon panels | Summon panel architecture (§4) |
| Electron has no iOS target and no OS-widget capability | iOS is a separate later codebase; no desktop widgets |
| Google Calendar `syncToken` polling is quota-free at personal scale; push needs an HTTPS webhook | §4 calendar sync design |
| X API is pay-per-use; Owned Reads $0.001/post with daily dedup; archives exclude bookmarks | §7.8 ingestion design |
| SimplifyJobs `listings.json` (`dev` branch) is the maintained structured source | Poll with ETag; never parse the README |
| pgvector HNSW ≤ 2000 dims | `text-embedding-3-small` @ 1536 |
| Duolingo research: auto-applied freezes raise retention; Earn-Back beats paid repair; gold/perfect states let flexibility and perfectionism coexist | Streak system (§6) |

## 11. Non-Goals and Deferred

**Non-goals:** multi-user collaboration, teams, sharing; a general-purpose Notion competitor; typed chat with Alfred; mascots/characters; OS desktop widgets; dark mode as the primary theme.

**Deferred, explicitly:** finance module (genuinely wanted, later); media tracking (cut); additional job sources; `events.watch` real-time calendar push; iCloud CalDAV; wake-word summoning; GPT-Live migration when its API ships; AFFiNE-class notes editor; freeze-management UI mechanics; per-component design drill-downs (colors, charts, fitness plotting) — the declared next phase.

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

## 13. Open Questions

- Summon panel contents beyond the locked glance (quick log? orb?).
- Freeze-management mechanics UI; fitness plotting; chart language; per-component color system.
- Config-defined tracker field-type catalog; jobs standing filters; task-reminder semantics.
- Bevel-clip ingestion schemas (to be locked before build).
- iOS app scope and stack (decided when the Mac app is finished).
