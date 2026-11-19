# AGENTS

_Last updated: 2026-11-19_

Operational guide for coding agents working on Manor.

## Project Overview

Manor is a personal productivity app for macOS. It is a native SwiftUI and AppKit app in `macos/` backed by Supabase in `supabase/`. The accepted product behavior, business rules, and scope are in [docs/PRD.md](docs/PRD.md); the dated decision record is [docs/DECISIONS.md](docs/DECISIONS.md). Technical design lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and its slices in `docs/arch-components/`. The design charter is [docs/DESIGN.md](docs/DESIGN.md).

Codex operates Manor through remote MCP. Backend jobs own ingestion, embeddings, and maintenance; hosted ChatGPT owns scheduled weekly review generation. Alfred, Manor's personal assistant, runs inside the app as a notch overlay and menu bar item (`macos/Sources/Alfred/`).

The production backend is deployed with the preserved user data; ARCHITECTURE's "Status" section lists what remains. Preserve existing user data and unrelated uncommitted work.

Supabase configuration lives in repo-root `.env.local` (never commit or print it). App build configuration lives in `macos/config/<environment>.env` (ignored by git). Migrations live in `supabase/migrations/`; the existing deployment uses the us-east-2 session pooler because its direct database host is IPv6-only.

## Repository Layout

```
manor/
├── macos/                   # Native app (Swift package)
│   ├── Sources/ManorKit/    # Core: gateway, auth, local mirror, files, domain rules
│   ├── Sources/Manor/       # App shell, design system, modules, settings
│   ├── Sources/Alfred/      # Alfred: overlay, menu bar, capture, transcription, answers
│   ├── Tests/               # ManorKitTests (Swift Testing) and AlfredTests (XCTest)
│   ├── Resources/           # Icon, asset catalog, fonts, math fonts, sounds, entitlements
│   ├── Vendor/SwiftMath/    # Vendored equation renderer
│   ├── config/              # Per-environment build settings (ignored) and the update public key
│   └── scripts/             # build-app.sh, release.sh, staging-session.sh, signing helpers
├── supabase/                # Migrations, Edge Functions, remote MCP, workers, SQL and Deno tests
├── site/                    # Static OAuth consent bridge page, deployed to GitHub Pages
├── .github/workflows/       # GitHub Pages deployment of site/
├── tools/problem-import/    # Problem catalog import, snapshot, and merge tooling
├── tools/problem-runner/    # Sandbox runtime image, harnesses, and smoke tests
├── tools/recovery/          # Encrypted backup and isolated restore operations
├── docs/                    # PRD, DECISIONS, ARCHITECTURE, arch-components, DESIGN, research
│   └── diagrams/            # Pele diagram sources (pele/*.mmd), theme, render script, SVGs
├── .agents/skills/          # Vendored skill groups and canonical inventory
└── .claude/skills/          # Discovery symlinks into .agents/skills/
```

## Commands

Run from the repository root unless noted:

- `swift build --package-path macos` and `swift test --package-path macos`: build the app and run the unit tests; required after code changes.
- `macos/scripts/build-app.sh [production|staging] [--debug] [--open]`: build, bundle, sign with the Developer ID certificate, and register `Manor.app` or `Manor Staging.app` in `macos/build/`.
- `macos/scripts/release.sh production <version> [notes.md]` and `macos/scripts/release.sh staging [notes.md]`: build, sign, notarize, and publish an update to GitHub Releases. Requires a clean tree, the Ed25519 key at `~/.config/manor/update_ed25519.key`, and the `manor-notary` notarization profile.
- `macos/scripts/release-and-install.sh <version> [notes.md]`: check the release prerequisites, publish a production release with `release.sh`, and install it in Applications on this Mac (the previous copy goes to the Trash).
- `macos/scripts/staging-session.sh [email]`: sign the installed staging app in as a synthetic staging user without Google (`PRINT_LINK=1` prints the link). Staging only.
- `npm --prefix supabase run typecheck` and `npm --prefix supabase test`: backend type checks and Deno tests.
- `npm --prefix docs/diagrams ci` once, then `npm --prefix docs/diagrams run render`: render every diagram in `docs/diagrams/pele/` to `docs/diagrams/svg/` (pass names after `--` to render only those).

Signed-in and end-to-end testing happens on a staging build, never against production. Setup for recovery tooling is in tools/recovery/README.md.

## Required Read Order

At the start of a session (and again after context compaction), before other work:

1. `docs/PRD.md`: product behavior; treat as binding.
2. `docs/ARCHITECTURE.md`: the system map, then the `docs/arch-components/` slices for the area you touch.

Before any UI/UX work, additionally read `docs/DESIGN.md` (the design charter).

## Decisions Discipline

- The PRD states current product behavior and contains no decision records. `docs/DECISIONS.md` records product decisions, dated and concise; superseded entries are marked superseded. ARCHITECTURE.md and its arch-components slices own technical design. Link between them rather than duplicating rules. If they conflict, flag the conflict instead of silently picking a side.
- The PRD and DECISIONS stay consistent: a decision that changes behavior updates the PRD in the same change.
- Settled decisions are not re-litigated unless the user reopens them. The PRD's "Platform and data policies", "Agents and background work", "Alfred", "Streak system", "Modules", and "Surfaces" sections hold the authority, privacy, retention, date, and module rules. The PRD's "Open product questions" lists open product choices; ARCHITECTURE's "Status" lists open technical work.
- When the user changes a decision, record it in DECISIONS and update the owning document in the same change unless the user explicitly asks to defer documentation. Remove superseded requirements rather than appending contradictory guidance.

## Domain Language

Use **module**, **Codex**, **MCP tools**, **Alfred** (with **General mode** and **Prep mode**), and **weekly review** as defined in the PRD. Use **perfect day**, **freeze pool**, and **Earn-Back** for streak mechanics; **scratch blocks** for disposable Manor-only time blocks. The stored note format is Manor's **block document format**.

## Skill Routing

Vendored skills live in `.agents/skills/emilkowalski-design/`; `.agents/skills/skills.lock.json` is the canonical inventory (pinned upstream commit and per-file hashes; update it whenever the inventory changes).

Additional skills preserve their source grouping: `browser-related/` contains `agent-browser` and the `chrome-devtools-mcp/` suite; `general/` contains `excalidraw-toolkit/`, `gh-cli`, and `manor-import`, the Manor-authored recipe an agent follows to import Markdown with its assets through the MCP tools. Each skill has a leaf-name discovery symlink under `.claude/skills/`, matching the existing convention. Installing skill instructions does not install the external CLIs or MCP servers they reference. Documentation diagrams use Pele, not the Excalidraw skills.

- `animate`: building any motion; `review-animations`: the QA gate on motion diffs (manual invoke); `animation-vocabulary`: naming an effect.
- `apple-design`: fluid, native-feel principles; read before gesture-driven or panel work.
- `prototype`: divergent UI variant exploration (manual invoke).
- `emil-design-eng`: general polish and taste layer.

Read a selected skill's full SKILL.md (plus companion files) before applying it. Skills cannot override PRD.md or user instructions. For UI reference material, pull real flows through the Mobbin MCP (query by app name: Obvious), and judge native behavior against Apple's Human Interface Guidelines.

## Design Anti-Patterns (hard rules: violating these is a failed deliverable)

- **Never leak spec/brainstorm language into UI copy.** No system-documentation captions in the product ("nightly ingestion", "parsed daily from SimplifyJobs", "no Earn-Back"). UI copy is product voice: concise labels and human sentences. Mechanics belong in Settings or a help surface, not scattered captions.
- **No em-dashes in UI copy.** Rewrite the sentence instead.
- **Use the current design charter.** Native, smooth surfaces and intentional light and dark modes replace paper grain, handwritten display type, sketched ink marks, and sticky-note decoration. Use SF Pro (the system font) for interface and body text, Outfit for page titles and headings, and the plum and gray `Palette` roles in DESIGN.md; never add a one-off color or literal size outside the design system. Liquid Glass is for floating chrome on macOS 26 only, with the solid fallback elsewhere. Monospace (SF Mono) is for code, and comparable numbers use tabular numerals.
- **No UI text below 12pt.** The one exception is dense time-grid gutters at 11pt (`Typography.Size.gutter`).
- **No left-edge accent bar/curve on selected sidebar items.** Selected state = background fill + weight/color change.
- **No mascots or characters, ever.**
- **Density must match data volume.** Collections that grow (bookmarks, feeds, logs) are compact lists/tables, never big card grids.
- **No padded-card page framing.** Content runs edge-to-edge; "page inside a page" layouts are failures.
- **Object details are centered dialogs.** Never use side peeks, drawers, sheets, right-edge panels, or detail rails. Primary page layouts, the app sidebar, inline popovers, menus, and tooltips are not object details.
- **Show states through design, not labels.** Gold/at-risk/status read from color, weight, and emphasis, not from explanatory text chips.
- **Design the workflows, not just the layouts.** Every surface ships its flows: create/edit paths, property controls, empty states, onboarding.
- **Honor the system's accessibility settings.** Increase Contrast, Reduce Transparency, and Reduce Motion must keep working through the `Palette`, `glassSurface`, and `Motion` helpers.
- Also binding: no emoji as icons (use SF Symbols); no fake OS chrome; tabular numerals for stats.

## Documentation Rules

- Docs other than this file are written for people, following the [Google developer documentation style guide](https://developers.google.com/style): sentence-case headings without numbers, second person for the reader, active voice, present tense, serial commas, code font for identifiers, no "e.g.", "i.e.", "via", or "please". Cross-reference sections by name and anchor, never by number.
- Instructions aimed at coding agents live only in this file. The other docs describe how Manor behaves and why; they do not tell an agent what to do.
- ARCHITECTURE.md stays a concise system map; detailed contracts, limits, and failure rules belong in the matching `docs/arch-components/` slice, which links back to it.
- Diagrams are generated with the pinned `pele` package: write Mermaid in `docs/diagrams/pele/<name>.mmd`, then run `npm --prefix docs/diagrams run render`. Never hand-edit the SVGs. Name a node's role with a class (`:::app`, or `class id role` in state diagrams) from the roles in `docs/diagrams/render.mjs` (people, app, local, backend, agent, external, async, gate, neutral); pick a role by what a node is, never by how it should look, and never set colors in a diagram. Prefix edge IDs with `async_`, `blocked_`, or `ok_` for those edge kinds. A `row_` subgraph lays nodes out in a row without drawing a boundary. The render fails on an unknown role.
- Every embedded diagram is introduced by a sentence, carries descriptive alt text, and is followed by the collapsed "Diagram key" block that shows `docs/diagrams/svg/_key.svg`. The surrounding prose covers what the diagram does not show rather than restating it. Keep diagrams few and meaningful.
- A diagram and the prose around it change together. When you edit a section that embeds a diagram, or a fact the diagram shows (a component, a flow, a cadence, a count), update its source in the same change and re-render; when you change a source, re-read its section for stale prose.
- Describe Manor's formats as Manor's own: the stored note format is Manor's block document format, and Alfred's generative UI is Alfred's own UI language emitted in ` ```ui ` blocks. Don't name the third-party projects these resemble or the retired design references, in docs, code, comments, or UI.
- Migration files under `supabase/migrations/` describe deployed history. Never edit an applied migration; add a new one.
- The repository layout is inventoried only in this file and the README; docs do not carry directory listings.
- Tests follow the repository strategy: build and the unit tests after code changes, plus focused integration or end-to-end coverage for the change on a staging build, never a broad mock-based suite.

## Working Rules

- **Secrets:** `.env.local` holds server-side credentials, including the Supabase access token, the OpenAI embedding key, and Google web OAuth credentials. Never commit it, echo it, or move it. Alfred's provider keys (Anthropic, OpenAI, Deepgram) are `alfred-proxy` function secrets; `.env.local` copies of them are development overrides. Never log or print them.
- **Real data only:** signed-in surfaces use real account data and honest empty states; never substitute fixtures or invented records.
- **QA:** before calling UI work done, run the staging build in the remote macOS sandbox and exercise every flow on the changed pages in both themes and window states, as the testing and QA slice describes.
- **Docs:** one source of truth per fact; abridge and point rather than duplicate across docs. New long-form research goes in `docs/`.
- **Last-updated stamps:** every doc (this file, `docs/*.md`, and `docs/arch-components/*.md`) carries a `_Last updated: YYYY-MM-DD_` line under its title. Whenever you edit a doc, update its stamp in the same change.
- **Deletions of user work and destructive git operations: ask first.**
