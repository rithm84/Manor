# Manor — Design Charter (hi-fi Electron shell)

The binding design reference for everyone building `app/`. Read fully before writing any UI. The product-mechanics truth is `docs/BRAINSTORM.md`; the canonical mock-data story is `docs/design/canvas/SPEC.md` §B (reuse it exactly — one story everywhere). The anti-patterns in `AGENTS.md` are hard rules; violating them is a failed deliverable.

## Direction

**Atelier, refined.** Light, warm-canvas, editorial, calm. Dark mode is rejected (harder to distinguish elements; this is a productivity instrument). Not gamified-colorful (Coop rejected), but emotional design still outranks minimalism: warmth, celebration moments, urgency states — executed with restraint.

**Blueprints, in order of authority:**
1. **Notion** (via Mobbin — pull flows before designing your surface): board/kanban UX bar-for-bar (his favorite thing from Notion — group pills with counts, tinted columns, card chips, "+ New" affordances at column bottoms, side-peek detail panels), sidebar behavior, property editors, settings anatomy. Notion Calendar for the calendar page.
2. **Obvious (obvious.ai)** — not on Mobbin; captured observations: warm cream canvas (#f5f3ef family) with deep forest-green (#2f4127) and amber moments; the agent is a *collaborator in a docked chat panel* beside real artifacts, not a floating gimmick; projects have view tabs across the top; kanban statuses are soft colored pills (sage/amber/blue/green); chunky rounded display headlines ("Less Chat. More Work."); product voice is confident and terse.
3. **design-md tokens** (below) as the base coat.

## Tokens (Atelier v2)

Surfaces: canvas `#faf9f5`, soft `#f5f0e8`, card `#ffffff` and `#efe9de`, strong `#e8e0d2`; ink `#141413`, body `#3d3d3a`, muted `#6c6a64`, hairline `#e6dfd8` (1px borders are the elevation system — shadows only on overlays/popovers: `0 4px 16px rgba(20,20,19,0.10)`).
Primary coral `#cc785c` (hover `#b8674e`, active `#a9583e`); forest `#2f4127` (grounding moments, primary-alt); accents teal `#5db8a6`, amber `#e8a55a`, gold `#b8860b` (streaks); semantic success `#5db872`, warning `#d4a017`, error `#c64545`.
Kanban group pills (the signature): Overdue = error-tinted pill, Today = amber, Tomorrow = warning-gold, This Week = plum `#8c6a9e`; pill = small filled chip w/ cream text + count beside it; columns get a barely-there tint.
Spacing: 4px base scale. Radii: 8px controls, 10–12px cards, 6px chips. Focus ring: coral at 15% alpha, 3px.

## Typography (roles are law)

- **UI face: Inter** (400/500/600) — everything interactive and data-bearing: nav, cards, chips, tables, forms, buttons. 13–14px body, 15–16px emphasized.
- **Display face: EB Garamond 500** — ONLY for page greetings/display headlines and rare celebration lines. Never inside components, stats, chips, or tables. When in doubt, Inter.
- **Mono face: JetBrains Mono** — code blocks and dense numeric columns only. Stats elsewhere: Inter with `font-variant-numeric: tabular-nums`.
- Fonts ship bundled via `@fontsource/*` (a proper product does not depend on a CDN).

## Copy voice (read twice)

Product voice: confident, terse, human. **Never** system-documentation captions in the UI ("nightly ingestion", "parsed daily from SimplifyJobs", "no Earn-Back", "fades 48h" as scattered annotations). If behavior needs explaining, it lives in Settings or an (i) popover written in product voice ("Blocks tidy themselves up two days after they end"). **No em-dashes anywhere in UI copy.** No exclamation-mark spam. Microcopy warmth is welcome ("Two left. The evening is yours.") but sparingly and never explaining mechanics.

## Structure (locked)

- **Sidebar:** Notion-style. Pinned state = fixed column (like the hi-fis). Collapsed state = fully hidden; hovering the left screen edge slides it in as a floating overlay; leaving dismisses it; a pin control re-docks it. Selected item = soft fill + weight change. **No left-edge accent bar/curve on selection.** Items: Home, Calendar, Habits, Fitness, Mood & Focus, LeetCode, Jobs, Notes, Bookmarks, Journal; bottom: Alfred activity, Settings, account.
- **Home = tasks kanban + Today panel. Nothing else.** No habits cluster, no Alfred strip. Kanban replicates the Notion board experience; Today panel = the day's events + scratch blocks + drop-target for time-blocking tasks.
- **Habit logging lives on its own surface** (the Habits page and/or an evening log flow), designed properly, uncongested.
- **Calendar = standalone full page**, Notion Calendar anatomy (sidebar w/ mini-month + calendar list, slim toolbar, week grid, right event panel; no teammates/availability).
- **Alfred = modal via the global hotkey (⌥Space)** with the **thinking orb** (NOT a character; the Archie/Rive plan is dead). Orb = small animated particle-sphere, reference orbs.jakubantalik.com (source: github.com/Jakubantalik/Libraries) — monochrome-warm dots, states: idle / listening / thinking; rendered inline beside status text ("Listening", "Thinking") and scaled up as the modal's centerpiece. Plus voice UI mock and the locked today's-completion glance.
- **Proper product, not a personal hack:** sign-in (Supabase-flavored) + first-run onboarding flow, Settings (account, connections, hotkeys, notifications), real empty states for a brand-new user on every module. Mock-only, but designed.
- **Density rule:** high-volume collections (bookmarks, logs, to-apply lists) are compact rows/tables. Card grids only for genuinely small, rich sets.
- **Workflows are the deliverable.** Every surface ships its flows clickable: create task (inline + full editor w/ property controls incl. recurrence), edit in side peek, add habit, mark applied, log day. Static pages without flows are incomplete.

## Craft bar

Read `.agents/skills/emilkowalski-design/emil-design-eng/SKILL.md` and apply it. Also `.agents/skills/emilkowalski-design/animate/SKILL.md` for any motion (spring-feel CSS transitions, 150–250ms, ease-out entrances; interruptible; nothing gratuitous). Hover/press states on everything interactive. Icons: one consistent inline-SVG stroke set (16px grid) — lucide-react is permitted and preferred over hand-drawn. Tabular numerals on all stats. No emoji as icons. No fake OS chrome inside pages (the Electron window is real chrome).

## Mobbin protocol (for every builder)

Before designing your surface, pull references with the Mobbin MCP tools (load via ToolSearch: `mcp__mobbin__search_flows`, `mcp__mobbin__search_screens`; platform "web"; name the app in the query, e.g. "Notion board view group by status", "Notion Calendar week view", "Notion side peek task properties", "Notion settings"; use flows wherever possible). Copy the good patterns bar-for-bar where they fit Manor; strip what does not apply. Cite in your final report which flows you leaned on.
