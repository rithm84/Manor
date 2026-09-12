# Notion June 2026 interaction findings, frames 301–601

_Last updated: 2026-09-09_

## Scope and evidence limits

Frames 301–601 of the supplied `Notion web Jun 2026 N.png` sequence were reviewed in labeled contact sheets. Frames 301–400 cover database properties, dates, views, and automation builders. Frames 401–601 mostly cover integrations, task aggregation, settings, onboarding, imports, and account administration; unrelated workspace, AI-agent, billing, and marketplace behavior was excluded from the Manor recommendations. A few frames below 301 were initially inspected during the earlier assigned range and remain available as supporting crops.

Every observation marked **Visible** is screenshot evidence. Every observation marked **Inference** is a proposed interaction contract or a likely behavior that static captures cannot prove. Screenshots do not establish focus order, keyboard handling, dismissal rules, save timing, error handling, hit-target size, responsive behavior, or animation timing.

## Findings for Manor

### 1. Keep property editing anchored and layered

**Visible:** Frames 301–304 show a three-level cascade: the property menu, the status-group editor, and a status-option editor with a fixed semantic color list. Each level preserves the originating context. Rows use a left icon or swatch, a direct label, and a trailing value, check, or chevron. Destructive actions sit with the edited option rather than in a separate settings page. Frame 303 is the clearest state.

**Manor application:** Use this anatomy for Context, Status, Priority, recurrence fields, saved-view filters, and Notes block properties. Open a compact anchored menu from the field. Let a submenu handle the next decision without replacing the task dialog. Keep the current value visible in the parent row. Do not copy Notion's unrestricted property system; Manor's domain fields remain fixed by the PRD.

**Inference:** Arrow-key traversal, typeahead, Escape returning one level, focus restoration, and viewport collision handling are appropriate acceptance requirements, but the captures do not prove them.

### 2. Treat a date as one compact transaction

**Visible:** Frames 322–324 keep the date operation in one cell-anchored popover. The top line is an editable date value. Month navigation, `Today`/`Now`, and the calendar occupy the first section. End date, display format, include-time, timezone, reminder, and Clear appear as lower rows. Turning on time adds a second value to the top field and reveals time-format/timezone rows without changing surfaces. The selected date is a filled blue rounded square; the current day is independently marked in red.

**Manor application:** Use the same stable anatomy for task due dates, recurrence boundaries, LeetCode attempt dates, and scratch-block dates. For task creation, replace Notion's generic options with Manor-specific constraints and quick choices such as Today and Tomorrow. When time is irrelevant, omit it entirely. Keep Clear as a quiet terminal row. Combine this anatomy with the already selected Mixpanel date-picker typography and surface tokens.

**Inference:** The sequence strongly suggests progressive disclosure after toggling time, but does not prove whether every selection saves immediately or waits for outside dismissal. Manor should make task-detail edits part of its explicit local draft contract.

### 3. Match dialog scale to decision complexity

**Visible:** Frame 350 uses a medium centered dialog for a builder. The header contains an editable name, scope selector, and close control. `When` and `Do` sections are linked vertically. Empty trigger/action rows are large, calm targets. Cancel and the disabled Enable action stay at opposite footer corners. Frames 354–360 progressively expand chosen actions inside the same dialog while their pickers remain anchored to the row. By contrast, frame 245 uses a much smaller centered dialog for five export settings, and frame 256 uses an even smaller confirmation with two full-width actions.

**Manor application:** Use three intentional scales: compact confirmation for one irreversible decision; small form for a few scalar settings; medium centered dialog for task details, recurrence, contexts, and multi-row workflows. Keep object details centered as the project rules require. Conditional fields should expand in place. Do not make every interaction a large modal.

**Inference:** Disabled-primary gating is visible, but validation messages and submit behavior are not. Manor must show field-level, actionable save errors and preserve the draft.

### 4. Use color as a paired foreground/background system

**Visible:** Frame 303's light-mode status palette uses pale backgrounds with darker labels. Frame 529 shows the same semantic families in dark mode: red, amber, and green status pills use colored dots, lighter text, and darker colored fills that remain distinct from the near-black table. Priority values use more rectangular fills but preserve readable light text. Table borders and secondary icons stay neutral, so semantic color is reserved for values.

**Manor application:** Define each semantic color as at least text, subtle fill, strong fill, and focus-ring tokens for both themes. Never place a dark-green label on a dark-green pill. For the reported 30-minute task pill, use a lighter foreground on the dark semantic fill or a dark foreground on a pale fill, then verify normal and hover/focus contrast. Preserve context identity across task cards, tables, dialogs, and filters with the same semantic pair.

**Inference:** Exact contrast ratios cannot be recovered reliably from compressed screenshots. Verify Manor tokens against WCAG contrast using rendered UI, including disabled and selected states.

### 5. Empty states should explain the missing prerequisite and offer one route forward

**Visible:** Frame 455 shows an empty My Tasks surface with one subdued icon, one sentence explaining what will appear, and a single link to configure sources. Frames 459–460 then use a centered selection dialog with search on the left, chosen items on the right, a visible selection count, and one Done action. Once configured, frame 456 becomes a compact task list rather than retaining onboarding decoration.

**Manor application:** Empty Tasks, Notes, Jobs, and calendar-feed states should name what belongs there and offer the exact create/connect action. Once data exists, remove the instructional framing. For bounded multi-select flows such as visible calendars or saved-view filters, keep available and selected values visibly separate and show the limit/count.

**Inference:** The screenshots do not prove whether selection is staged until Done. Manor should stage modal multi-selection and commit once, because cancellation and failure behavior are then unambiguous.

### 6. Make keyboard help searchable and structurally scannable

**Visible:** Frame 486 uses a wide centered keyboard-shortcuts dialog with category tabs, search, plain-language action names, right-aligned keycaps, and fine row dividers. It presents shortcuts as reference content, not tooltips scattered through the application.

**Manor application:** Notes editing and collection navigation need a searchable shortcut reference once their bindings are settled. Keep visible menu labels usable without shortcuts; display bindings as secondary right-aligned keycaps. Avoid claiming Notion parity until the actual Manor bindings are implemented and tested.

### 7. Preserve density in task and collection views

**Visible:** Frames 456 and 529 render growing task collections as compact rows with checkboxes, document icons, titles, sources/properties, and minimal row chrome. Frame 529's dark table demonstrates that semantic pills can remain compact and legible without turning each record into a card. The primary action remains at the upper right, while filter/sort/search controls are icon-sized and grouped nearby.

**Manor application:** Keep Master Tasks, Jobs Browse, logs, and bookmark collections as dense lists/tables. Reserve cards for the bounded Weekly board. Use tabular numerals for dates, counts, streaks, and durations. The visible Notion density is a useful ceiling, while Manor's 12px minimum text rule remains binding.

## Crop inventory

Coordinates are source-pixel `(left, top, right, bottom)` bounds on the supplied 1920 × 1320 images. Crops preserve source pixels.

| Crop | Frame | Coordinates | Use |
|---|---:|---:|---|
| `status-color-cascade-f303.png` | 303 | `(1030, 210, 1780, 1080)` | Status groups, option editing, light-theme colors |
| `date-popover-f322.png` | 322 | `(1430, 270, 1800, 960)` | Base date transaction |
| `date-time-popover-f324.png` | 324 | `(1430, 270, 1800, 960)` | Time and timezone disclosure |
| `automation-builder-empty-f350.png` | 350 | `(620, 90, 1295, 890)` | Empty medium builder dialog |
| `automation-builder-filled-f358.png` | 358 | `(620, 95, 1300, 1060)` | Expanded action and anchored selector |
| `my-tasks-empty-f455.png` | 455 | `(450, 80, 1450, 700)` | Empty-state hierarchy |
| `keyboard-shortcuts-f486.png` | 486 | `(470, 65, 1430, 1090)` | Searchable shortcut reference |
| `dark-table-status-colors-f529.png` | 529 | `(90, 70, 1830, 930)` | Dense dark table and semantic contrast |
| `property-type-picker-f285.png` | 285 | `(780, 220, 1360, 870)` | Supporting overlap: type picker anatomy |
| `property-cascade-f290.png` | 290 | `(780, 220, 1530, 870)` | Supporting overlap: two-level property menu |
| `compact-export-dialog-f245.png` | 245 | `(735, 430, 1180, 765)` | Supporting overlap: small form scale |
| `restore-confirmation-f256.png` | 256 | `(710, 450, 1200, 720)` | Supporting overlap: compact confirmation scale |

## Excluded evidence

Frames 405–445 center on external agent and integration setup. Frames 462–483 center on marketplace browsing. Frames 489–601 largely cover collaboration, account, workspace, billing, import, and administrative settings. They were reviewed for general form anatomy, but they do not justify adding those product areas to Manor. Frames 365–371 show a large AI-agent editor; its split configuration/preview layout is outside Manor's settled Codex boundary and should not be copied into the product.
