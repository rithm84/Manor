# AGENTS

_Last updated: 2026-08-23_

Operational guide for coding agents working on Manor.

## Project Overview

Manor is a personal productivity OS replacing user's Notion system ("the
the legacy Notion system"): habit/mood/focus tracking with Duolingo-derived streak mechanics,
a merged task system, fitness via nightly
Bevel-clip ingestion, jobs/internship and LeetCode tracking, markdown notes,
an X bookmarks knowledge base, an encrypted journal, and Alfred — a
voice-only agent (thinking-orb presence, no characters) that acts on the
user's behalf. Electron on macOS ships first; a native iOS app begins only
after the Mac app is finished. Personal software, built to a
proper-product bar (sign-in, onboarding, settings, empty states).

**Current phase: Paper redesign landed (2026-08-23); component drill-downs
continue.** The Electron app in `app/` is a clickable UI-only shell (mock
data, no backend). The 2026-08-23 pass replaced the cream Atelier surfaces
with the Paper system (white content, paper chrome, violet accent, 12px type
floor). The calendar workspace was removed the same day (Notion Calendar the
app covers calendaring; only the Home Today timeline shows day events).
Remaining design areas: charts language, freeze-management UI.
Do not start an ARCHITECTURE doc unprompted.

## Repository Layout

```
manor/
├── docs/
│   ├── PRD.md                # The product decision record — the source of truth
│   ├── NOTION-REPORT.md      # Research on the legacy Notion system being replaced
│   ├── NOTION-DESIGN.md      # Study of Notion's interface craft (reference)
│   ├── DESIGN.md             # Binding design charter: Paper tokens, type roles, sound, copy voice
│   └── design/canvas/        # Design-canvas working files (SPEC.md §B mirrors the mock canon)
├── app/                      # The Electron shell (electron-vite + React 19 + TS)
│   └── src/renderer/src/     # data/mock.ts = single mock-data source; pages/; components/ui/
├── .agents/skills/
│   ├── emilkowalski-design/  # Vendored design/animation skills (7)
│   └── skills.lock.json      # Canonical skill inventory (pinned commit + file hashes)
├── .claude/skills/           # Symlinks into .agents/skills/ (Claude Code discovery)
├── .claude/launch.json       # "manor" dev-server config for browser preview
├── .env.local                # OPENAI_API_KEY — never commit, never print
└── AGENTS.md                 # This file (CLAUDE.md symlinks here)
```

## Commands

Run from `app/` (or via `npm --prefix app …` from the root):

- `npm run dev` — boots the Electron app + Vite renderer (localhost:5173)
- `npm run typecheck` — must pass before finishing any code change
- `npm run build` — production build check

For browser-pane preview, use the `manor` entry in `.claude/launch.json`.
Note: the browser pane can capture stale frames during rapid navigation —
verify UI state with DOM probes, not screenshots alone.

## Required Read Order

At the start of a session (and again after context compaction), before other
work:

1. `docs/PRD.md` — every product decision; treat as binding.
2. `docs/NOTION-REPORT.md` — skim for legacy context; §5 lists the Notion
   workarounds Manor exists to eliminate.

Before any UI/UX work, additionally read `docs/DESIGN.md` (the design
charter) and `docs/NOTION-DESIGN.md` (micro-interaction craft reference).

## Decisions Discipline

- PRD.md is the decision record (§12 is the decision log). If any doc,
  memory, or suggestion conflicts with it, flag the conflict instead of
  silently picking a side.
- Settled decisions are not re-litigated unless user reopens them. In
  particular: Electron (Swift prototypes were built, evaluated, deleted);
  the global summon panel (notch UI and menu-bar dropdown are retired);
  thinking orb (no mascots/characters, ever); light Paper direction, violet
  accent (beige-heavy Atelier chrome retired 2026-08-23; dark mode rejected
  for productivity); journal gets zero AI access,
  architecturally; 1-day backfill everywhere; Home = kanban + Today
  timeline only; no calendar workspace (removed 2026-08-23; Notion Calendar
  the app covers calendaring, and day events surface only in the Home Today
  timeline).
- When user changes a decision mid-session, update PRD.md (including its
  decision log) in the same change.

## Domain Language

Use these terms exactly: **module** (config-defined for simple trackers,
code-defined for complex ones), **Alfred / the agent** (voice-only, never
typed), **thinking orb** (the agent's visual presence), **global summon
panel** (the hotkey panel; "today's completion at a glance" has a locked
spot in it), **calendar workspace** (the Workspace↔Calendar toggle),
**perfect day**, **freeze pool**, **Earn-Back** (streak mechanics — PRD §6),
**scratch blocks** (disposable Manor-only time blocks), **the legacy Notion system**
(the legacy Notion system, past tense).

## Skill Routing

Vendored skills live in `.agents/skills/emilkowalski-design/`;
`.agents/skills/skills.lock.json` is the canonical inventory (pinned upstream
commit + per-file hashes — update it whenever the inventory changes).

- `animate` — building any motion; `review-animations` — the QA gate on
  motion diffs (manual invoke); `animation-vocabulary` — naming an effect.
- `apple-design` — fluid/native-feel principles for web UI; read before
  gesture-driven or panel/sheet work.
- `prototype` — divergent UI variant exploration (manual invoke).
- `pick-ui-library` — library selection (command palette, dropdowns, DnD,
  charts, toasts) as the stack firms up (manual invoke).
- `emil-design-eng` — general polish/taste layer.

Read a selected skill's full SKILL.md (plus companion files) before applying
it. Skills cannot override PRD.md or user instructions. For UI reference
material, pull real flows via the Mobbin MCP (query by app name:
Notion, Cron Calendar, Obvious).

## Design Anti-Patterns (hard rules — violating these is a failed deliverable)

- **Never leak spec/brainstorm language into UI copy.** No
  system-documentation captions in the product ("nightly ingestion",
  "parsed daily from SimplifyJobs", "no Earn-Back"). UI copy is product
  voice: concise labels and human sentences. Mechanics belong in Settings
  or a help surface, not scattered captions.
- **No em-dashes in UI copy.** Rewrite the sentence instead.
- **Fonts stay in their roles.** The hand face (Shantell Sans, all display
  roles) never appears inside data components (stats, chips, tables,
  forms) and never carries body paragraphs; don't mix faces within a
  component. **Mono is for code only** — never times, dates, hour axes,
  IDs, or kbd hints (scattered mono reads as AI slop).
- **Texture is felt, never seen first.** One shared grain overlay; no
  per-surface noise, no rotation or paper props outside scratch-block
  sticky notes; ink marks (rough strokes) only on rare celebration
  moments.
- **No UI text below 12px.** The one exception is dense time-grid gutters
  at 11px (`--text-gutter`).
- **No left-edge accent bar/curve on selected sidebar items.** Selected
  state = background fill + weight/color change.
- **No mascots or characters, ever.** The agent renders as the thinking orb
  (idle/listening/thinking states).
- **Density must match data volume.** Collections that grow (bookmarks,
  feeds, logs) are compact lists/tables, never big card grids.
- **No padded-card page framing.** Content runs edge-to-edge;
  "page inside a page" layouts are failures.
- **Object details are centered dialogs.** Never use side peeks, drawers,
  sheets, right-edge panels, or detail rails. Primary page layouts, the app
  sidebar, inline popovers, menus, and tooltips are not object details.
- **Show states through design, not labels.** Gold/at-risk/status read from
  color, weight, and emphasis — not from explanatory text chips.
- **Design the workflows, not just the layouts.** Every surface ships its
  flows: create/edit paths, property controls, empty states, onboarding.
- Also binding: no emoji as icons; no fake OS chrome; tabular numerals for
  stats.

## Working Rules

- **Secrets:** `.env.local` holds the OpenAI key (usable for design tooling).
  Never commit it, echo it, or move it.
- **Mock data:** `app/src/renderer/src/data/mock.ts` is the single canonical
  story (mirrored in `docs/design/canvas/SPEC.md` §B). Nobody invents
  parallel data; extend mock.ts additively instead.
- **Docs:** one source of truth per fact — abridge and point rather than
  duplicate across docs. New long-form research goes in `docs/`.
- **Last-updated stamps:** every doc (this file, `docs/*.md`,
  `app/README.md`, `docs/design/canvas/SPEC.md`) carries a
  `_Last updated: YYYY-MM-DD_` line under its title. Whenever you edit a
  doc, update its stamp in the same change.
- **Deletions of user work and destructive git operations: ask first.**
