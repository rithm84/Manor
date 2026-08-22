# Notion Design Notes

_Last updated: 2026-08-20_

A study of Notion's interface design and product philosophy — normalized notes from a talk (timestamps reference the source video). Reference material on how a mature block/database product handles micro-interaction craft, primitive design, and iteration.

---

## 1. Micro-Interactions & Interface Craft

### Pointer forgiveness
- **Safe triangles for submenus** — on diagonal pointer movement toward an open submenu, compute the triangle between the pointer position and the submenu's bounding box, and suppress the close while the pointer stays inside it [00:11:13]. Prevents premature collapse when navigating diagonally [00:15:22].
- **Expanded hitboxes** — small controls (e.g. checkboxes) register clicks slightly outside their visual bounds; forgiving targets over pixel-perfect ones [00:12:43].

### Typography & optical alignment
- **Tabular numerals in lists** — `font-variant: tabular-nums` on numbered lists so digit widths match ("1" as wide as the digits of "10") and baselines/adjacent text stay vertically aligned across single- and double-digit items [00:12:26].
- **Unified icon baselines** — page icons, view icons, and "new page" glyphs share optical grid lines across all page views [00:15:42].

### State machines & keyboard behavior
- **Indent state machine** — Tab indents one level, but a level can't be skipped unless a sibling already exists at that depth; Shift+Tab outdents, and at the top level clears the bullet [00:11:33].
- **Mention-menu focus retention** — in the `@` mention popover, ←/→ move the text cursor through the typed query *without* the results dropdown losing focus [00:13:46].
- **Non-native auto-scrolling** — arrow-key navigation through long dropdowns scrolls the container itself, maintaining consistent top/bottom padding around the highlighted item, and stops at the edges rather than looping [00:10:44].

### Adaptive rendering
- **Dynamic border radius** — list items and table-row hover states recalculate corner radii on the fly based on whether adjacent items are selected/focused/active, so selection containers read as one smooth shape [00:13:02].

## 2. Core Principles

- **Composable Lego blocks** — expose generic foundational primitives (databases, toggle lists, generic buttons, filters) that users assemble into bespoke applications, rather than shipping narrow specialized tools [00:02:44].
- **Overcoming blank-canvas syndrome:**
  - *Scaffolded empty states* — a new empty database shows **five** empty placeholder rows, not one; the visual structure demonstrates what a populated table looks like [00:16:21].
  - *AI-assisted setup* — let the user describe what they want and generate initial database properties/column schemas from the description [00:03:52].
- **Progressive disclosure via user segmentation** [00:18:24] — Notion's tiers, to prevent interface bloat:
  - **Residents** (~60–70%): out-of-the-box documents and layouts.
  - **Gardeners**: customize properties, metadata, time zones.
  - **Builders/Architects**: formulas, relational rollups, custom layouts.
- **Avoid the "average cockpit" trap** — designing for the average user fails everyone (US Air Force cockpit study) [00:19:30]; instead, layer advanced customization (e.g. custom page-layout builders) behind progressive disclosure [00:19:51].

## 3. Discarded Concepts (iteration lessons)

| Concept explored | Why it was tested | Why it failed / was simplified |
|---|---|---|
| Chat-first email client [00:07:52] | Make email feel as rapid/lightweight as Slack-style messaging | Stripped too much necessary thread structure; ineffective for email workflows |
| Full database-table inbox [00:08:30] | Treat inbox metadata (subject, sender, dates) as customizable, draggable database columns | Arbitrary resizing + multi-column editing across window sizes became visually distracting and hard to use [00:09:04] |
| Open-ended autopilot sandbox [00:20:41] | Natural-language prompts performing any action on an inbox (extract, translate, archive) | Users suffered from lack of clear boundaries; simplified to Auto-Label with suggested buttons and sample-email training [00:21:29] |
| Unified email primitives [00:06:43] | Modern clients clutter UI with overlapping markers (starred, pinned, flagged, important, folders, labels) | Collapsed into a single core primitive: customizable labels + filtered views [00:07:14] |
