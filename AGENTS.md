# AGENTS

_Last updated: 2026-09-13_

Operational guide for coding agents working on Manor.

## Project Overview

Manor is a personal productivity web app replacing the legacy Notion system. The accepted
product behavior, business rules, and scope are in [docs/PRD.md](docs/PRD.md).
Technical design lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Codex operates Manor through remote MCP. Backend jobs own ingestion, embeddings, and maintenance; hosted ChatGPT Work owns scheduled review generation.
The UI redesign uses Mixpanel aesthetics and Notion editing UX, with
deliberately designed light and dark modes. See docs/DESIGN.md and the
evidence in docs/REDESIGN-REPORT.md; retained Paper styles are superseded.

**Implementation status:** `app/` is a runnable Vite web app with real Supabase adapters, transactional commands, shared agent tools, and durable Notes editing. The production backend and `mymanor.vercel.app` are deployed with the preserved user data; release acceptance items remain in ARCHITECTURE §1. See ARCHITECTURE §1 for precise verification limits and §10 for acceptance checks. Preserve existing user data and unrelated uncommitted work.

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
├── tools/recovery/          # Encrypted backup and isolated restore operations
├── tools/diagrams/          # Official Excalidraw SVG export tooling
├── .agents/skills/          # Vendored skill groups and canonical inventory
└── .claude/skills/          # Discovery symlinks into .agents/skills/
```

## Commands

Run from the repository root:

- `npm --prefix app run typecheck` — required after code changes.
- `npm --prefix app test` — domain and UI checks.
- `npm --prefix app run dev` — local web app on port 5173.
- `npm --prefix app run build` — build the Vite web application.
- `npm --prefix tools/diagrams run render` — export documentation SVGs.
- `npm --prefix tools/perf run bench -- <session.json> <origin> <label>` — signed-in performance benchmark; see docs/PERFORMANCE.md.

Local dev servers cover unauthenticated UI work, typecheck, and tests only; localhost is not an authorized staging origin, so signed-in and end-to-end testing happens on the hosted staging site. Never substitute showroom fixtures for signed-in data. Setup is in app/README.md. Recovery tooling and its provisioning requirements are in tools/recovery/README.md.

## Required Read Order

At the start of a session (and again after context compaction), before other
work:

1. `docs/PRD.md` — product decisions; treat as binding.
2. `docs/ARCHITECTURE.md` — technical decisions and implementation status.
3. If the ignored local research file exists, skim [legacy workflow workarounds](docs/NOTION-REPORT.md#5-workflow-workarounds). It is private reference material, not a required checkout dependency.

Before any UI/UX work, additionally read `docs/DESIGN.md` (the design
charter) and `docs/NOTION-DESIGN.md` (micro-interaction craft reference).

## Decisions Discipline

- PRD.md owns product decisions (§12 is its concise log); ARCHITECTURE.md
  owns technical decisions. Link between them rather than duplicating rules.
  If they conflict, flag the conflict instead of silently picking a side.
- Settled decisions are not re-litigated unless user reopens them. Consult
  PRD §§4–8 for authority, privacy, retention, dates, and module rules.
  PRD §13 lists open product choices; ARCHITECTURE §11 lists technical details.
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
