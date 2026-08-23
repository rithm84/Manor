# Manor — Design Charter (hi-fi Electron shell)

_Last updated: 2026-08-22_

The binding design reference for everyone building `app/`. Read fully before writing any UI. The product-mechanics truth is `docs/PRD.md`; the canonical mock-data story is `app/src/renderer/src/data/mock.ts` (mirrored in `docs/design/canvas/SPEC.md` §B — one story everywhere). The anti-patterns in `AGENTS.md` are hard rules; violating them is a failed deliverable.

## Direction

**Atelier, refined.** Light, warm-canvas, editorial, calm. Dark mode is rejected (harder to distinguish elements; this is a productivity instrument). Not gamified-colorful (Coop rejected), but emotional design still outranks minimalism: warmth, celebration moments, urgency states — executed with restraint.

**Blueprints, in order of authority:**
1. **Notion** (via Mobbin — pull flows before designing your surface): board/kanban UX bar-for-bar (his favorite thing from Notion — group pills with counts, tinted columns, card chips, "+ New" affordances at column bottoms), sidebar behavior, property editors, settings anatomy. Object details adapt those property patterns into Manor's centered dialogs. Notion Calendar informs the calendar page.
2. **Obvious (obvious.ai)** — not on Mobbin; captured observations: warm cream canvas (#f5f3ef family) with deep forest-green (#2f4127) and amber moments; the agent is a *collaborator in a docked chat panel* beside real artifacts, not a floating gimmick; projects have view tabs across the top; kanban statuses are soft colored pills (sage/amber/blue/green); chunky rounded display headlines ("Less Chat. More Work."); product voice is confident and terse.
3. **design-md tokens** (below) as the base coat.

## Tokens (Aubergine Editorial)

Surfaces: canvas `#faf8f3`, soft `#f5efe9`, card `#ffffff`, strong `#e9e0d9`; ink `#191719`, body `#403b40`, muted `#6a6669`, hairline `#e4dcd5` (1px borders are the elevation system; shadows only on overlays/popovers: `0 4px 16px rgba(25,23,25,0.10)`).
Primary Aubergine `#6a4e6c` (hover `#5b415d`, active `#4c354e`, tint `#f0e8f0`) is reserved for primary actions. Semantic strong/tint pairs: completion `#3b684b` / `#e7f1e9`; Today warning `#825d16` / `#f7ecd2`; Tomorrow olive-gold `#6d6422` / `#efecd8`; overdue error `#a33f46` / `#f8e4e5`; frozen info `#416883` / `#e5eef4`; This Week plum `#6b5375` / `#eee8f1`.
Kanban group pills (the signature) use the dark semantic strong color with white text; their columns use the matching opaque tint. Sidebar colors are near-neutral and separate from the brand: background `#f2efea`, border `#e4dcd5`, hover `#ece8e4`, selected `#e8e4e2`; active navigation text stays ink-colored.
Spacing: 4px base scale. Radii: 8px controls, 10–12px cards, 6px chips. Generic links, focus, scratch blocks, and module accents do not inherit the brand primary; focus uses frozen-info with its opaque tint ring.

## Typography (roles are law)

- **UI face: Inter** (400/500/600) — everything interactive and data-bearing: nav, cards, chips, tables, forms, buttons. 13–14px body, 15–16px emphasized.
- **Display face: EB Garamond 500** — ONLY for page greetings/display headlines and rare celebration lines. Never inside components, stats, chips, or tables. When in doubt, Inter.
- **Mono face: JetBrains Mono** — code blocks and dense numeric columns only. Stats elsewhere: Inter with `font-variant-numeric: tabular-nums`.
- Fonts ship bundled via `@fontsource/*` (a proper product does not depend on a CDN).

## Copy voice (read twice)

Product voice: confident, terse, human. **Never** system-documentation captions in the UI ("nightly ingestion", "parsed daily from SimplifyJobs", "no Earn-Back", "fades 48h" as scattered annotations). If behavior needs explaining, it lives in Settings or an (i) popover written in product voice ("Blocks tidy themselves up two days after they end"). **No em-dashes anywhere in UI copy.** No exclamation-mark spam. Microcopy warmth is welcome ("Two left. The evening is yours.") but sparingly and never explaining mechanics.

## Structure (locked)

- **Sidebar:** Notion-style. Pinned state = fixed column (like the hi-fis). Collapsed state = fully hidden; hovering the left screen edge slides it in as a floating overlay; leaving dismisses it; a pin control re-docks it. Selected item = soft fill + weight change. **No left-edge accent bar/curve on selection.** Items: Home, Calendar, Habits, Mood & Focus, LeetCode, Jobs, Notes, Bookmarks, Journal; bottom: Alfred activity, Settings, account.
- **Home = tasks kanban + Today panel. Nothing else.** No habits cluster, no Alfred strip. Kanban replicates the Notion board experience; Today panel = the day's events + scratch blocks + drop-target for time-blocking tasks.
- **Habit logging lives on its own surface** (the Habits page and/or an evening log flow), designed properly, uncongested.
- **Calendar = standalone full page**, Notion Calendar anatomy (sidebar w/ mini-month + calendar list, slim toolbar, week grid, centered event dialog; no teammates/availability).
- **Object details = centered dialogs, always.** Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited. The rule does not convert primary page layouts, the app sidebar, inline popovers, menus, or tooltips.
- **Alfred = modal via the global hotkey (⌥Space)** with the **thinking orb** (NOT a character; the Archie/Rive plan is dead). Orb = small animated particle-sphere, reference orbs.jakubantalik.com (source: github.com/Jakubantalik/Libraries) — monochrome-warm dots, states: idle / listening / thinking; rendered inline beside status text ("Listening", "Thinking") and scaled up as the modal's centerpiece. Plus voice UI mock and the locked today's-completion glance.
- **Proper product, not a personal hack:** sign-in (Supabase-flavored) + first-run onboarding flow, Settings (account, connections, hotkeys, notifications), real empty states for a brand-new user on every module. Mock-only, but designed.
- **Density rule:** high-volume collections (bookmarks, logs, to-apply lists) are compact rows/tables. Card grids only for genuinely small, rich sets.
- **Workflows are the deliverable.** Every surface ships its flows clickable: create task (inline + full editor w/ property controls incl. recurrence), edit in centered detail dialogs, add habit, mark applied, log day. Static pages without flows are incomplete.

## Craft bar

Read `.agents/skills/emilkowalski-design/emil-design-eng/SKILL.md` and apply it. Also `.agents/skills/emilkowalski-design/animate/SKILL.md` for any motion (spring-feel CSS transitions, 150–250ms, ease-out entrances; interruptible; nothing gratuitous). Hover/press states on everything interactive. Icons: one consistent inline-SVG stroke set (16px grid) — lucide-react is permitted and preferred over hand-drawn. Tabular numerals on all stats. No emoji as icons. No fake OS chrome inside pages (the Electron window is real chrome).

## Mobbin protocol (for every builder)

Before designing your surface, pull references with the Mobbin MCP tools (load via ToolSearch: `mcp__mobbin__search_flows`, `mcp__mobbin__search_screens`; platform "web"; name the app in the query, e.g. "Notion board view group by status", "Notion Calendar week view", "Notion task properties", "Notion settings"; use flows wherever possible). Copy the good patterns bar-for-bar where they fit Manor; strip what does not apply. Cite in your final report which flows you leaned on.
