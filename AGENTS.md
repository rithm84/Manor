# AGENTS

_Last updated: 2026-09-14_

Operational guide for coding agents working on Manor.

## Project Overview

Manor is a personal productivity app for macOS replacing the legacy Notion system. The accepted
product behavior, business rules, and scope are in [docs/PRD.md](docs/PRD.md).
Technical design lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Codex operates Manor through remote MCP. Backend jobs own ingestion, embeddings, and maintenance; hosted ChatGPT Work owns scheduled review generation.
The UI redesign uses Mixpanel aesthetics and Notion editing UX, with
deliberately designed light and dark modes. See docs/DESIGN.md and the
evidence in docs/REDESIGN-REPORT.md; retained Paper styles are superseded.

**Implementation status:** `app/` is the React frontend (Vite) with real Supabase adapters, transactional commands, shared agent tools, and durable Notes editing, and `desktop/` is the Tauri shell that packages it as the macOS app and ships signed updates from GitHub Releases. The production backend is deployed with the preserved user data; ARCHITECTURE's "Status" section lists what is verified and what remains, and its "Migration and verification" section lists the acceptance checks. Preserve existing user data and unrelated uncommitted work.

Supabase configuration lives in repo-root `.env.local` (never commit or print
it). Migrations live in `supabase/migrations/`; the existing deployment uses
the us-east-2 session pooler because its direct database host is IPv6-only.

## Repository Layout

```
manor/
├── docs/                    # PRD, ARCHITECTURE, DESIGN, interface research
│   └── diagrams/            # Editable Excalidraw scenes and exported SVGs
├── app/src/
│   ├── ui/                  # React components, view services, styles, fixtures
│   ├── shared/              # Domain types, validation, and calculations
│   └── web/                 # Authentication, Supabase adapters, drafts, services
├── supabase/                # Migrations, remote MCP, ingestion, and workers
├── desktop/                 # Tauri 2 desktop shell: Rust crate, config, icons
├── tools/recovery/          # Encrypted backup and isolated restore operations
├── tools/diagrams/          # Official Excalidraw SVG export tooling
├── .agents/skills/          # Vendored skill groups and canonical inventory
└── .claude/skills/          # Discovery symlinks into .agents/skills/
```

## Commands

Run from the repository root:

- `npm --prefix app run typecheck` — required after code changes.
- `npm --prefix app test` — domain and UI checks.
- `npm --prefix app run dev` — the Vite dev server that `npm --prefix desktop run dev` opens the app window against.
- `npm --prefix app run build` — build the frontend bundle that the desktop shell embeds.
- `npm --prefix desktop run build` and `npm --prefix desktop run build:staging` — build the macOS app for production or staging; `npm --prefix desktop run release` and `release:staging` build, sign, and publish an update; `npm --prefix desktop run benchmark` measures launch and navigation on the installed app; `desktop/README.md` covers setup, env files, and installation.
- `npm --prefix tools/diagrams run compose && npm --prefix tools/diagrams run render` — rebuild the documentation diagrams from `tools/diagrams/scenes.mjs` and export their SVGs.

The dev server covers unauthenticated UI work, typecheck, and tests only; the dev origin is not an authorized backend origin, so signed-in and end-to-end testing happens on a staging build bundle (`build:staging -- --debug`, registered with Launch Services), never with `tauri dev` against an authorized backend. The Rust crate must pass `npm --prefix desktop run fmt`, `lint`, and `test`. Never substitute showroom fixtures for signed-in data. Setup is in app/README.md. Recovery tooling and its provisioning requirements are in tools/recovery/README.md.

## Required Read Order

At the start of a session (and again after context compaction), before other
work:

1. `docs/PRD.md` — product decisions; treat as binding.
2. `docs/ARCHITECTURE.md` — technical decisions and implementation status.
3. If the ignored local research file exists, skim [legacy workflow workarounds](docs/NOTION-REPORT.md#5-workflow-workarounds). It is private reference material, not a required checkout dependency.

Before any UI/UX work, additionally read `docs/DESIGN.md` (the design
charter) and `docs/NOTION-DESIGN.md` (micro-interaction craft reference).

## Decisions Discipline

- PRD.md owns product decisions (its "Decision log" is the concise record);
  ARCHITECTURE.md owns technical decisions. Link between them rather than
  duplicating rules. If they conflict, flag the conflict instead of silently
  picking a side.
- Settled decisions are not re-litigated unless the user reopens them. The
  PRD's "Platform and data policies", "Codex, agent tools, and background
  work", "Streak system", "Modules", and "Surfaces" sections hold the
  authority, privacy, retention, date, and module rules. The PRD's "Remaining
  product detail" lists open product choices; ARCHITECTURE's "Remaining
  technical work" lists technical ones.
- When user changes a decision, update its owning document in the same
  change unless the user explicitly asks to defer documentation. Record
  significant product decisions in the PRD log; keep technical design current
  in ARCHITECTURE.md.
  Remove superseded requirements rather than appending contradictory guidance.

## Domain Language

Use **module**, **Codex**, **MCP tools**, **daily synthesis**, and
**weekly review** as defined in the PRD. Use **perfect day**, **freeze pool**,
and **Earn-Back** for streak mechanics; **scratch blocks** for disposable
Manor-only time blocks; **legacy Notion system** for the system being replaced.

## Skill Routing

Vendored skills live in `.agents/skills/emilkowalski-design/`;
`.agents/skills/skills.lock.json` is the canonical inventory (pinned upstream
commit + per-file hashes — update it whenever the inventory changes).

Additional skills preserve their source grouping: `browser-related/` contains
`agent-browser` and the `chrome-devtools-mcp/` suite; `general/` contains
`excalidraw-toolkit/` and `gh-cli`. Each skill has a leaf-name discovery symlink
under `.claude/skills/`, matching the existing convention. Installing skill
instructions does not install the external CLIs or MCP servers they reference.

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
- **Use the current design charter.** Mixpanel-informed sans-serif typography,
  smooth surfaces, and intentional light/dark modes replace paper grain,
  handwritten display type, sketched ink marks, and sticky-note decoration.
  Use Outfit headings, DM Sans body/interface text, and the plum/gray direction in DESIGN.md; final theme tokens still require visual and contrast verification.
  Monospace is for code, and comparable numbers use tabular numerals.
- **No UI text below 12px.** The one exception is dense time-grid gutters
  at 11px (`--text-gutter`).
- **No left-edge accent bar/curve on selected sidebar items.** Selected
  state = background fill + weight/color change.
- **No mascots or characters, ever.**
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

## Documentation Rules

- Docs other than this file are written for people, following the
  [Google developer documentation style guide](https://developers.google.com/style):
  sentence-case headings without numbers, second person for the reader,
  active voice, present tense, serial commas, code font for identifiers, no
  "e.g.", "i.e.", "via", or "please". Cross-reference sections by name and
  anchor, never by number.
- Instructions aimed at coding agents live only in this file. The other docs
  describe how Manor behaves and why; they do not tell an agent what to do.
- Diagrams are generated: edit `tools/diagrams/scenes.mjs`, then run the
  compose and render commands. Never hand-edit the `.excalidraw` or `.svg`
  files. Every diagram is introduced by a sentence and carries descriptive alt
  text, and the surrounding prose covers what the diagram does not show rather
  than restating it. Scenes use Excalifont, hand-drawn strokes, the Excalidraw
  palette, and icons from the vendored libraries in `tools/diagrams/libraries/`.
- A diagram and the prose around it change together. When you edit a section
  that embeds a diagram, or a fact the diagram shows (a component, a flow, a
  cadence, a count), update its scene in the same change and re-render; when
  you change a scene, re-read its section for stale prose.
- Compose fails when an arrow runs through a node, a label, or another arrow
  (`tools/diagrams/check.mjs`, also `npm --prefix tools/diagrams run check`
  for the exported files). Fix findings by rerouting with `via` waypoints or
  moving nodes, never by weakening the check. When a new class of layering
  defect shows up in a render, extend the checker so it catches that class.
- Migration files under `supabase/migrations/` describe deployed history. Never
  edit an applied migration; add a new one.
- The repository layout is inventoried only in this file; docs do not carry
  directory listings.
- Tests follow the repository strategy: typecheck and the app test suite
  after code changes, plus focused integration or end-to-end coverage for the
  change, never a broad mock-based suite.

## Working Rules

- **Secrets:** `.env.local` holds server-side credentials, including the OpenAI embedding key and Google web OAuth credentials.
  Never commit it, echo it, or move it.
- **Mock data:** `app/src/ui/data/mock.ts` is the single canonical
  showroom story. Nobody invents parallel data; extend mock.ts additively
  instead. Signed-in surfaces never substitute it for real account data.
- **Docs:** one source of truth per fact — abridge and point rather than
  duplicate across docs. New long-form research goes in `docs/`.
- **Last-updated stamps:** every doc (this file, `docs/*.md`,
  `app/README.md`) carries a
  `_Last updated: YYYY-MM-DD_` line under its title. Whenever you edit a
  doc, update its stamp in the same change.
- **Deletions of user work and destructive git operations: ask first.**
