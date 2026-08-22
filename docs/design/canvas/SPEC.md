# Manor Hi-Fi Round 2 — Build Spec (for builder agents)

_Last updated: 2026-08-21_

You are building HI-FI static mockup artboards for Manor, a personal productivity macOS app (Electron). Three aesthetic directions share ONE locked structure. You build ONE direction (told in your prompt), 11 artboards, as `.dc.html` files in `<repo root>/docs/design/canvas/`.

Read before building:
1. This file, fully.
2. `<repo root>/.agents/skills/emilkowalski-design/emil-design-eng/SKILL.md` — the polish/craft bar.
3. `<repo root>/docs/PRD.md` §5–§7 (product truths).

## A. File format (violations break the canvas — follow exactly)

Every artboard file has this exact skeleton:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="GOOGLE FONTS URL — &amp; between families">
  <style>
    body { margin: 0; font-family: ...; color: ...; }
    a { color: ...; } a:hover { color: ...; }
  </style>
</helmet>
<div style="width: 1440px; height: 900px; box-sizing: border-box; overflow: hidden; ...">
  ...static content...
</div>
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
```

Rules:
- PURE STATIC MARKUP ONLY: no `{{holes}}`, no `<sc-for>`, no `<sc-if>`, no props beyond `$preview`. Repeated rows are written out literally.
- Keep the `<script src="./support.js"></script>` line exactly. Root div is exactly 1440×900 (`overflow: hidden`).
- Canonical HTML: close every non-void element (including all SVG children), double-quote every attribute. All styling INLINE via `style="…"` except the body/a rules in `<helmet><style>`.
- Layout: flex/grid with `gap` for every sibling group — never whitespace/inline spacing, never per-element margins where gap works.
- Escaping in text: `&amp;` `&lt;` `&gt;` `&#39;` `&quot;`. Google Fonts URL: `&amp;` between families.
- Icons: inline stroke SVG on a 16px grid, one consistent style per direction. NEVER emoji or dingbat glyphs. Checkmark glyph "✓" is banned — draw a check path.
- Numerals in stats/chips/tables: `font-variant-numeric: tabular-nums` + the direction's mono font where specified.
- No fake macOS chrome: no traffic lights, no menu bar, no fake status bars. The artboard IS the window content.
- No lorem ipsum, no filler. Every element earns its place.

## B. The canonical data story (identical across ALL artboards and directions)

Today is **Wednesday, August 20**. User: user.
- Habits (10): Morning Routine ✓(streak 45, gold), Night Routine ✓(32, gold), Wind-Down &amp; Prep ○(21), Deep Work 90m ✓(17), Read 25 pages ✓(21, gold), Water 48 oz ✓(26), Protein 105 g ○(14), Family QT 15m ○(169, gold, AT RISK tonight), Sleep by 11:30 ○(10), Manor Logging ✓(62, gold). **6/10 today.** Freeze pool **7/10** left (August). Gold badge = ≥7 freeze-free days. Earn-Back = 2 clean days in 48h, once/habit/month. Quantized habit demo: Water at 100 (0/25/50/75/100 only).
- Tasks: Overdue(1): "Hackathon team form" (Hackathons, &lt;30min, 1d late). Today(2): "MyMathLab 14.2" (Uni, &lt;2hrs, High), "Send CS 225 transcript to UCLA" (Personal, &lt;30min). Tomorrow(2): "Chapter 14 Practice Exam" (Uni, Exam, &gt;4hrs), "Book skin doc appt" (Personal). This Week(4): "Neetcode — Two Pointers" (Leetcode, &lt;3hrs, In Progress, due Fri, ½ time-blocked today 14:00–15:00 + rest Fri 14:00), "Weekly review + plan" (Personal, recurring Sun), "Update resume — fall apps" (Apps, &lt;3hrs), "Load Airtel account" (Personal, &lt;30min).
- Calendar Wed: Calc III lecture 10:00–11:15 (Google, green), Neetcode scratch block 14:00–15:00 (dashed, Manor-only, "fades 48h after end"), Gym 16:30–17:30 (Google). Now-line at ~13:00.
- Mood/Focus: not logged today. Mood scale (5): Great/Good/Neutral/Bad/Awful. Focus scale (6): Locked In/High/Medium/Low/Locked Out/Resting. One entry each per day; combined voice debrief optional.
- Fitness: nightly Bevel clip ingestion — "Last clip processed 11:42 PM · calories + workout normalized by terra". Yesterday: 2,140 in / 310 out / deficit −270. Week avg in 2,109. Muscle groups (9): Chest, Biceps, Triceps, Back, Core, Shoulders, Traps, Legs, Cardio; this week hit: Chest, Biceps, Legs, Cardio (4/9); longest streaks: Cardio 22, Legs 11, Chest 6.
- LeetCode: Neetcode **42/150**. Topics (done/total): Arrays &amp; Hashing 9/9 ✓, Two Pointers 3/5 (current), Sliding Window 4/6, Stack 5/7, Binary Search 4/7, Linked List 6/11, Trees 8/15, rest 3/90 untouched. Own streak **5**, own freeze pool **3/5** (no Earn-Back). Solved today: 0 (block at 14:00).
- Jobs: To-apply new today(4): Anthropic — SWE Intern Agents (SF), Figma — Product Eng Intern (SF/NYC), Scale AI — SWE Intern ML Infra (SF), Ramp — SWE Intern (NYC); older: Modal (2d), Perplexity (3d). Action = "Mark applied". Pipeline (12 active): Applied 7 (OpenAI Aug 19, Palantir Aug 18, Cohere Aug 17, +4), OA 2 (Databricks due Fri, Stripe due Sun), Interviews 3 (Vercel Int 2 Mon 11:00, Notion Int 1 scheduling, Linear Int 1 Thu 15:00), Rejected: Meta (OA). Funnel: 34→10→5→1. Source: SimplifyJobs, parsed daily.
- Bookmarks: 9 ingested overnight, themes CUDA kernels + Electron perf; sample posts by @karpathy (CUDA kernels thread, linked article captured), @swyx, @thorstenball; semantic search box.
- Notes: folders (Calc III, CS 225, Manor, Misc); open doc "Calc III — Ch 14 review" with a heading, prose, one code block, one image attachment placeholder.
- Journal: locked (Touch ID), "End-to-end encrypted · Alfred can never read this". 61 entries.
- Alfred: morning briefing prepared 7:00 AM (streaks, 4 job matches, exam tomorrow). Audit trail: "Logged Water — 9:42 PM Tue", "Created task &#39;two-pointers set&#39; — Aug 18". Voice exchange sample: "log protein and family time, and mark the neetcode problem done" → "Done — Protein, Family QT, and one LeetCode problem logged. Eight of ten today; two left." (glance dots show 8/10 in the modal AFTER that exchange).

## C. The 11 artboards (structure LOCKED, aesthetics yours)

Name files `<Prefix><Page>.dc.html` with your direction's prefix.

1. **Home** — the work page. Persistent left nav (list or rail: Home, Calendar, Habits, Fitness, Mood &amp; Focus, LeetCode, Jobs, Notes, Bookmarks, Journal; Alfred audit + settings at bottom). Content: (a) tasks kanban, 4 columns with COLORED GROUP PILLS (Overdue red / Today orange / Tomorrow yellow / This Week purple — the Notion-board DNA: pill label + count, subtly tinted columns, cards with context/difficulty/priority chips); (b) today column — vertical day strip (08:00–22:00 compressed) with events + dashed scratch blocks, tasks draggable in (show one mid-drag or drop-hint affordance); (c) habits: compact daily check row/cluster (6/10 ring or bar, one-tap circles) + a weekly overview strip (7-day dots or mini-pills per habit, abbreviated); (d) Alfred strip: briefing-ready chip, 1–2 aggregate/insight lines, freeze pool + at-risk callout. Header: date, streak state. This page is dense-but-breathing: it must feel like a workbench, not a dashboard brochure.
2. **Alfred** — the modal (⌥Space in-app) over the dimmed Home: Archie character (see D), listening waveform, the sample exchange, completion glance row (8/10 dots + freezes + LC streak), last-audit line, hotkey hints. The emotional peak page — the character must feel alive/present.
3. **Calendar** — standalone full page, Notion-Calendar anatomy: left sidebar (mini month Aug 2026 w/ 20 highlighted; calendar list w/ colored rounded-square checkboxes: Google personal (green), UCLA (blue), Manor scratch blocks (dashed swatch, "local only"); "+ add account"); slim top bar (sidebar toggle, Today btn, "August 2026" + chevrons, GMT-8, D/W/M switcher with W active, search); week grid Mon 18–Sun 24: hour gutter 8–19, all-day row, weekday headers (Wed emphasized), red now-line ~13:00 on Wed, solid rounded events in calendar colors, dashed scratch blocks (incl. faded Mon one), overlapping pair somewhere; right event panel OPEN for the Neetcode block: title, calendar picker (Manor · scratch), Wed 14:00–15:00, linked task chip "Neetcode — Two Pointers (½)", recurrence none, note "fades 48h after end — the task stays", delete/done actions. ⌘K hint bottom. Strip: teammates, availability, conferencing, participants.
4. **Habits** — full fidelity: per-habit rows (name, streak flame count, gold badge, best, 7-day week strip honoring the story: Mon/Tue history, Wed = today state, Thu+ blank/future) + ONE per-habit monthly heatmap open for a selected habit (Family QT: August grid, mostly filled, today pending + "169 — longest ever" framing) + freeze pool card (7/10, earn rule, Earn-Back explainer) + add/pause affordances + quantized Water control (100). This was his favorite page last round — make it the flagship.
5. **Fitness** — Bevel ingestion card (clip → terra → normalized; last run 11:42 PM; "calories ✓ workout ✓"); calories: yesterday 2,140/310/−270, 7-day bar or line (numbers visible), week avg; muscle groups: 3×3 grid or row (9 groups, 4 hit this week, streak chips Cardio 22 / Legs 11 / Chest 6, THIS WK vs PREV WK vs 2 WKS AGO treatment somewhere); note "data arrives nightly — nothing to log by hand here".
6. **MoodFocus** — today's two selectors (Mood 5, Focus 6 — big friendly one-tap targets), "or debrief with Alfred" secondary path, then history: last-14-days twin strips + a small monthly texture; a recent debrief summary snippet card ("terra summary, AI-visible by design").
7. **LeetCode** — Neetcode 150 progress (42/150 hero), topic list w/ per-topic progress bars (data above), own streak 5 + own pool 3/5 "no Earn-Back — hard mode" framing, problems/day intensity element (e.g., last-14-days columns where height = solves), today 0 + the 14:00 block linkback.
8. **Jobs** — to-apply list (4 new today amber-dotted + 2 older, "Mark applied" buttons, "applied &amp; seen auto-hide"); pipeline board (stage columns w/ counts + company cards, OA due dates, interview times); funnel 34→10→5→1 (horizontal bars, labeled). Source line: SimplifyJobs daily.
9. **Notes** — 3-pane: folder tree (4 folders, expanded Calc III), doc list, open doc "Calc III — Ch 14 review": H1, prose paragraph, code block (mono, syntax-tinted, e.g. a short Python snippet), image attachment placeholder frame, "agent-readable · embedded for retrieval" footer chip.
10. **Bookmarks** — header "9 ingested overnight · themes: CUDA kernels, Electron perf"; semantic search input ("that post about CUDA kernels…"); 5–6 post cards (author handle, post text 1–2 lines, linked-article chip on 2 showing captured title, open-on-X link icon); "every 15 min via Owned Reads · $0.001/post" footnote.
11. **Journal** — locked state hero (lock icon, "Unlock with Touch ID", "End-to-end encrypted — the key never leaves this Mac. Alfred can never read this."), recovery-key line, 61 entries count; a small ghosted/blurred preview of the entries list behind the lock to imply what unlocking reveals.

Emotional/UX requirements everywhere: streak flames and gold states are celebrated, not muted; at-risk states create urgency without shame; empty/idle states have warmth (a line of voice, or the character in Coop); the kanban pills pop; hover/press affordances are visible in at least one place per page (a pressed-state button, a hovered row). Density per emil's bar: aligned optical grids, generous-but-purposeful spacing, clear type hierarchy — never cramped, never airy-empty.

## D. Archie (the character placeholder)

Flat vector mascot, drawn as inline SVG (~120–200px): a chubby rounded owl-ish bird, big oval eyes with heavy lids, small brows, tiny beak, no outlines, soft shapes (Clucky mascot school). Recolor per direction. Poses: attentive (Alfred modal), sleeping (idle/empty states), celebrating (arms up — gold streak contexts). Label nothing "placeholder" in the UI — he's just Archie. Keep him OUT of Journal (privacy) and use sparingly outside the Alfred modal except in Coop.

## E. Direction token sheets

### Direction "Coop" (prefix `Coop`) — Clucky × Duolingo: playful, flat, warm
- Fonts: `<link ... family=Nunito:wght@600;700;800;900&amp;family=Geist+Mono:wght@400;500 ...>`; body 15px Nunito 600 `#17130e`; display Nunito 800/900, tight tracking (-0.02em); stats Geist Mono tabular.
- Surfaces: page `#ededed`, raised `#f3f3f3`, card `#ffffff`, dark tile `#17130e` (for hero/stat tiles, Clucky mission-tile style). NO box-shadows — hierarchy via gray steps. Radii: cards 20–28px, buttons pill 100px or 14px.
- Accents: gold `#ffc014`, burnt orange `#cc3f02`, feather green `#58cc02` (success/done), macaw blue `#1cb0f6`, cardinal `#ff4b4b` (overdue), bee `#ffc800`, beetle purple `#ce82ff`. Kanban pills: cardinal/fox orange `#ff9600`/bee/beetle — saturated fills, white or ink text.
- Duolingo 3D recipe for primary buttons + interactive cards: flat fill, radius 12–16px, hard lip `box-shadow: 0 4px 0 <15% darker same hue>`; secondary: white face, 2px `#e5e5e5` border, `0 2px 0 #e5e5e5` lip. Show one pressed state (no lip, translateY(4px) visually implied).
- Streak flames chunky filled gold/orange SVG; habit checks = big round green-filled buttons with white check path. Archie appears: Home Alfred strip (small), Alfred modal (large), one empty state.
- Register: warm, snarky-lite microcopy ("Two left. The couch can wait."), celebration over information, but STILL a workbench — density on Home stays real.

### Direction "Atelier" (prefix `Atelier`) — design-md warm-canvas editorial
- Fonts: `EB+Garamond:wght@500;600` display + `Inter:wght@400;500;600` UI + `JetBrains+Mono:wght@400;500` numerals/code. Display always weight 500 serif with negative tracking (28–40px, -0.3 to -0.5px); "bigger serif before bolder weight". Body Inter 14/16px `#3d3d3a`.
- Surfaces: canvas `#faf9f5`, soft `#f5f0e8`, card `#efe9de`, strong `#e8e0d2`, dark block `#181715` (inner `#1f1e1b`) for code/stat moments. Ink `#141413`, muted `#6c6a64`, hairline `#e6dfd8` (1px borders = elevation). Shadows banned except `0 1px 3px rgba(20,20,19,0.08)` on one hover.
- Primary coral `#cc785c` (buttons h40 r8, white text; active `#a9583e`); accents teal `#5db8a6`, amber `#e8a55a`; semantic success `#5db872`, warning `#d4a017`, error `#c64545`. Kanban pills: muted-saturated editorial takes — error/amber/warning-gold/a plum you derive — as small filled pills with cream text; columns tinted with the surface ramp.
- Spacing 4px base (4/8/12/16/24/32/48), radii 8 controls / 12 cards, focus ring coral 3px 15% alpha. Inline links coral.
- Register: calm literary warmth; celebration = a serif line + gold accent, not confetti; Archie rendered in cream/coral flat vector, appearing ONLY in the Alfred modal.

### Direction "Noir" (prefix `Noir`) — his dark DNA: warm near-black + colored pills + mono
- Fonts: `Geist:wght@400;500;600;700` + `Geist+Mono:wght@400;500`. Body Geist 13.5–14px `#e8e2d9`; headers Geist 700 tight; ALL numerals + labels-chips Geist Mono tabular; section labels mono uppercase letter-spaced.
- Surfaces: page `#141210`, panel `#1b1815`, card `#221e1a`, hairline `#312b24`, hover `#292420`. Text `#e8e2d9`, muted `#9a9184`, faint `#6b6459`. No pure black, no pure white; warm undertone throughout (his Notion dark).
- Kanban pills (THE signature, from his screenshot): small filled label chips — Overdue `#5e2a22` bg / `#f0917d` text; Today `#5c3d1d`/`#f2b46a`; Tomorrow `#5a4a1c`/`#e8cf6f`; This Week `#3f2d55`/`#c9a8ef`; columns get a barely-there tint of their hue. Tag chips same recipe smaller. 
- Accents: gold `#ffc014` (streaks/gold states, glows: `box-shadow: 0 0 18px rgba(255,192,20,0.25)` on celebration elements — Noir's confetti is glow), green `#7dc98f` done, red `#e0654f` risk, blue `#6fa8dc` info. Buttons: filled `#e8e2d9` ink-text primary, bordered ghost secondary; radius 8–10px.
- Register: focused, nocturnal, precise; emotion via glow, weight, and mono rhythm; Archie appears in the Alfred modal only, drawn in warm grays + gold.

## F. Canvas frames

Every artboard 1440×900. Your prompt tells you your prefix; produce exactly these files: `<P>Home`, `<P>Alfred`, `<P>Calendar`, `<P>Habits`, `<P>Fitness`, `<P>MoodFocus`, `<P>LeetCode`, `<P>Jobs`, `<P>Notes`, `<P>Bookmarks`, `<P>Journal` (+`.dc.html`).

## G. Self-review before you finish (mandatory)

Re-open each file and verify: renders as intended at 1440×900 (no overflow past the root, no element visually cut mid-way); data matches §B exactly; nav shows the SAME items on every page with the current page marked; icons consistent; tabular-nums on stats; pills/chips consistent; every interactive-looking element has a plausible state; no emoji; no unclosed tags (search for `<div` vs `</div>` balance per file); Google Fonts URL uses `&amp;`. Fix everything you find. Your final report: file list with line counts + 3 bullets on the emotional-design moves you made.
