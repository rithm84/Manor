# Manor — Design Charter (hi-fi Electron shell)

_Last updated: 2026-08-24_

The binding design reference for everyone building `app/`. Read fully before writing any UI. The product-mechanics truth is `docs/PRD.md`; the canonical mock-data story is `app/src/renderer/src/data/mock.ts` (mirrored in `docs/design/canvas/SPEC.md` §B — one story everywhere). The anti-patterns in `AGENTS.md` are hard rules; violating them is a failed deliverable.

## Direction

**Paper.** Light, paper-white, editorial, calm — the 2026-08-23 evolution of the Atelier direction. The heavy cream/beige surfaces of the first hi-fi pass are retired: they muddied readability and made chrome compete with content. Content lives on white; app chrome (sidebars, rails, wells) sits on barely-warm paper neutrals; **violet is the single interaction accent**; semantic colors appear only when they mean something. Dark mode remains rejected. Emotional design still outranks minimalism — warmth, celebration moments, urgency states — executed with restraint.

**The printed page you write on (2026-08-23, second pass).** Manor is a printed instrument: Inter is the *print*, a faint paper grain is the *stock*, and the hand face plus rough ink marks are *your marks on it*. Handwriting appears only where a person would plausibly write on a printed page — greetings, titles, empty-state headlines, celebrations, marginalia. Data is always print. Texture is always felt, never seen first.

**Blueprints, in order of authority:**
1. **Notion** (via Mobbin — pull flows before designing your surface): board/kanban UX (group pills with counts, softly tinted columns, card chips, "+ New" affordances), sidebar behavior, property editors, settings anatomy. Object details adapt those property patterns into Manor's centered dialogs.
2. **The tokens below** as the base coat. When a value is not here, derive it from a token (`color-mix`), never invent a literal.

## Tokens (Paper Violet)

Defined in `app/src/renderer/src/styles/tokens.css` — the single source of truth. Never write a color, radius, shadow, or font-size literal in page CSS; if a needed value is missing, add a token first.

**Surfaces:** canvas `#ffffff` (all content areas), paper `#fafaf8` (app chrome: sidebar, rails), soft `#f5f4f1` (hover wells, banners), strong `#eae8e3` (pressed wells); card = canvas + hairline border (cards are delineated by border and shadow, not by a different fill).
**Ink:** ink `#1b191d`, body `#3f3b44`, muted `#6e6975`. Muted is for secondary text at ≥12px only — never for primary content.
**Hairlines:** `#e8e6e1` (default), `#dcd9d3` (controls/emphasized). 1px borders are the elevation system; shadows only on overlays.
**Shadows (one black, tokenized):** hover `0 1px 3px rgba(27,25,29,0.07)`; overlay `0 16px 40px rgba(27,25,29,0.12), 0 2px 6px rgba(27,25,29,0.05)`. No other shadow recipes.
**Violet (the accent):** primary `#71549e`, hover `#654a8d`, active `#57407b`, tint `#f2edf9`. Violet owns: primary buttons, links, focus rings, selected states, active filters, and progress accents. If an accent is not semantic, it is violet.
**Streak fire (2026-08-24):** habit completion marks (checkboxes, quantized quarters, week segments) are **completion green**; achievement lives only in the streak indicator, a classic fire flame on the `--streak` ladder (`#e8590c` / deep `#d9480f` / glow `#ff922b` / core `#ffd43b`). Flame states: ember (no streak), dim (streak at risk today — gray body, live core), lit, blazing (freeze-free week). Live flames flicker subtly (reduced-motion: static). Today's week segment never pre-fills with state.
**Semantic pairs (strong / tint):** completion `#3d7a52` / `#e6f2ea`; today amber `#8f6a0e` / `#f8efd8`; tomorrow gold `#6f671f` / `#f1eeda`; overdue red `#b0434b` / `#f9e6e7`; info blue `#48708e` / `#e8eff5`; this-week plum `#6f5680` / `#efe9f4`. The Today timeline's now-line is violet (`--timeline-now` → `--primary`; 2026-08-23 decision).
**Kanban (the signature, kept):** group pills use the dark semantic strong color with white text; columns use a *light* wash of the matching tint (mixed toward white) so boards read as paper, not slabs.
**Spacing:** 4px base scale. **Radii:** 6px chips, 8px controls, 10px cards, 12px overlays/dialogs. Nothing else — no 3/5/7/9/15/16px.

## Typography (roles are law)

- **UI face: Inter** (400/500/600 — the only loaded weights; never specify 550–750, they render as fake 600). Body 14px, secondary 13px, micro 12px, emphasized 15–16px. **The floor is 12px.** One exception: dense time-grid gutters (the Today timeline hour axis) may use 11px. 8–10px type is prohibited.
- **Hand face: Shantell Sans Variable** (`--font-display` / `--font-hand`; EB Garamond retired 2026-08-23) — every display role: page titles, the wordmark, the Home greeting, empty-state headlines, celebration lines, Journal dates and lock screen, and Notes document titles and headings (2026-08-24). **Never inside data components** (stats, chips, tables, buttons, forms), never carrying paragraphs of body text, never below 16px, never with negative tracking. When in doubt, print it in Inter.
- **Mono face: JetBrains Mono 400** — **code only** (code blocks, solution editors, inline code). Never for times, dates, hour axes, step numbers, IDs, or kbd hints. Stats and times everywhere: Inter with `font-variant-numeric: tabular-nums` (the `.tnum` utility).
- Microlabels (uppercase section headings) use one shared recipe: 12px / 600 / 0.04em / muted. Do not invent per-page variants.
- Fonts ship bundled via `@fontsource/*`.

## Paper stock and ink marks

- **Grain:** one pre-baked feTurbulence tile (`--paper-grain`, opacity `--paper-grain-opacity` ≈ 5%) rendered as a single static fixed overlay (`body::after`) — the whole window shares one paper stock. Never a live SVG filter, never a per-element grain layer on scrolling content, never an opacity that reads as noise before it reads as paper.
- **Ink marks (rough-notation / hand-drawn SVG):** the `HandCircle` around a perfect day's count, the drawn-on checkbox stroke, the sketched rings behind empty-state icons and around selected Mood & Focus chips, the squiggle under empty-state titles. Animated marks stay reserved for rare moments (never hover, never keyboard-driven or 100+/day actions, reduced-motion fallback always). Ink marks are single fitted SVGs — never a `repeat-x` tile (tiled squiggles read as broken dashes; tried and retired 2026-08-23).
- **The hand voice (beyond display):** buttons, segmented view toggles, kanban group pills, and section titles write in the hand face (`ui.css` "hand voice" block). Data still prints — tables, chips, stats, times, form values never go hand.
- **Sticky notes:** scratch blocks are disposable paper and get the full skeuomorph — `--sticky-note` stock, hair-of-rotation, dog-ear fold, handwritten note text. They are direct-manipulation paper: drag a sticky to move it in the Today timeline; drag on empty timeline to write a new one. Kanban task cards are the second sanctioned paper prop (2026-08-23): white note stock, 3px corners, a dog-ear showing the column wash, ±0.3° tilt. Nothing else gets rotation or literal paper props.

## Sound (tasteful, sparse)

A single quiet sound layer (`renderer/src/sound/`) synthesized via WebAudio — no audio assets. The voice is **tactile, not tonal**: band-passed noise taps with a low thump (a pen landing on paper), never pure sine beeps. Sounds exist for **completion moments only**: checking off a task or habit (soft felt tap), a perfect-day/streak celebration (three soft mallet strikes). Nothing on navigation, hover, typing, or errors. Master toggle in Settings → Appearance; default on; volume well under system alert level. If a sound calls attention to itself, it is too loud or too long.

## Copy voice (read twice)

Product voice: confident, terse, human. **Never** system-documentation captions in the UI ("nightly ingestion", "parsed daily from SimplifyJobs", "no Earn-Back", "fades 48h" as scattered annotations). If behavior needs explaining, it lives in Settings or an (i) popover written in product voice ("Blocks tidy themselves up two days after they end"). **No em-dashes anywhere in UI copy.** No exclamation-mark spam. Microcopy warmth is welcome ("Two left. The evening is yours.") but sparingly and never explaining mechanics.

## Structure (locked)

- **Sidebar:** Notion-style. Pinned state = fixed column. Collapsed state = fully hidden; hovering the left screen edge slides it in as a floating overlay; leaving dismisses it; a pin control re-docks it. Selected item = soft fill + weight change. **No left-edge accent bar/curve on selection.** Items: Home, Habits, Mood & Focus, LeetCode, Jobs, Notes, Bookmarks, Journal; bottom: the account row, which opens an upward menu holding Alfred activity and Settings (2026-08-24).
- **Home = tasks kanban + Today panel. Nothing else.**
- **Habit logging lives on its own surface.**
- **Object details = centered dialogs, always.** Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited. The rule does not convert primary page layouts, the app sidebar, inline popovers, menus, or tooltips. Dialog anatomy follows Notion's property-row pattern: borderless click-to-edit fields in an icon-gutter grid, hairline section dividers, generous padding — not boxed form inputs.
- **Alfred = modal via the global hotkey (⌥M)** with the **thinking orb** (no characters, ever). Orb = small animated particle-sphere (reference orbs.jakubantalik.com), violet-warm dots, states: idle / listening / thinking. Below the orb and voice controls sits a Notion-style page search (type, arrow, Enter to jump); it replaced the completion glance 2026-08-24 and is also why the sidebar carries no search field.
- **Proper product, not a personal hack:** sign-in + onboarding, Settings, real empty states on every module.
- **Density rule:** high-volume collections (bookmarks, logs, to-apply lists) are compact rows/tables. Card grids only for genuinely small, rich sets.
- **Workflows are the deliverable.** Every surface ships its flows clickable.

## Consistency contract (one recipe per pattern)

These live in `components/ui/ui.css` (or `base.css`) and pages consume them — never re-implement per page: buttons, chips (24px / 6px radius / card surface), segmented view toggles, switches, kbd hints, table headers (13px / 500 / sentence case), microlabels, empty states, focus ring (violet), progress bars (4px / 999px radius), scrollbars. A page that needs a variant extends the shared class; a page that redefines the pattern is a defect.

## Craft bar

Read `.agents/skills/emilkowalski-design/emil-design-eng/SKILL.md` and apply it. Also `.agents/skills/emilkowalski-design/animate/SKILL.md` for any motion (150–250ms, strong ease-out entrances; interruptible; nothing gratuitous; no animation on keyboard-driven or 100+/day actions). Hover/press states on everything interactive. Icons: lucide-react, one consistent stroke set on a 16px grid. Tabular numerals on all stats. No emoji as icons. No fake OS chrome inside pages.

## Mobbin protocol (for every builder)

Before designing your surface, pull references with the Mobbin MCP tools (load via ToolSearch: `mcp__mobbin__search_flows`, `mcp__mobbin__search_screens`; platform "web"; name the app in the query, e.g. "Cron Calendar week view", "Notion board view group by status", "Notion task properties", "Notion settings"; use flows wherever possible). Copy the good patterns bar-for-bar where they fit Manor; strip what does not apply. Cite in your final report which flows you leaned on.
