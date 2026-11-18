# Manor design charter

_Last updated: 2026-11-18_

This page defines Manor's visual and interaction direction for the native Mac app. Product behavior is in the [PRD](PRD.md); the tokens and components that implement this charter are in the [design system](arch-components/design-system.md) slice.

## Direction

Manor is a smooth, restrained, native Mac product. It looks and behaves like a well-made macOS app first: system type, standard controls tinted with Manor's accent, real menus and shortcuts, and materials that follow the platform. Document editing and contextual controls prioritize direct manipulation, and the day's timeline presents a clear view of the schedule. Manor has its own palette, and the earlier paper-and-ink identity, grain, handwritten type, sketched marks, and sticky-note styling are retired.

The high-level layout stays: Home's task board beside a single-column day timeline, Tracking's daily list and history, and two-pane Notes. Content uses the window directly. There is no padded card around a whole page, and no page inside a page.

## Type

- **SF Pro**, the system font, is the face for interface text, body copy, controls, and note reading text. Its optical sizes keep it crisp beside Liquid Glass.
- **Outfit** is the face for page titles and headings, used sparingly so it reads as a voice rather than decoration.
- **SF Mono** is for code and code-like values only. Monospace elsewhere in the interface reads as unfinished.
- Comparable statistics, times, and counts use tabular numerals.
- No product text is smaller than 12 points. The one exception is the 11-point gutter of the dense time grid.

Note reading text has its own comfortable scale and line length; compact controls don't justify cramped prose. Hierarchy comes from weight, size, and spacing, not from more colors.

## Color

Plum and neutral gray are the palette, with a muted teal as the secondary accent for supporting highlights, breaks, and chart differentiation. Every color is a named role with independently tuned light and dark values, and every text and control pairing is checked for contrast in both themes: 4.5:1 for text and 3:1 for meaningful control edges.

- Canvas, sidebar, inset controls, raised surfaces, and overlays have distinct roles in each theme. A darker surface is not automatically a disabled one.
- Hover, selected, and selected-hover fills are distinct, and selection stays distinguishable from keyboard focus.
- Every semantic family (completion, warning, error, frozen, due buckets, and the mood and focus scales) defines its text separately from its subtle and strong fills. Text and fill are never one color at two opacities.
- Completion marks are green; the streak flame alone carries achievement, in its own orange tones. Gold state is a gilded flame and number.
- Chart series keep their identity across themes, tuned for readability in each, and labels, shapes, or strokes carry meaning where color alone can't. Missing data stays distinct from zero and from an explicitly logged rest day.
- Photographs, embeds, code highlighting, selection, and transparent images have their own theme behavior, never a blanket inversion.

## Light and dark

Both modes are designed deliberately and verified with realistic dense and empty states. The theme preference is system, light, dark, or day and night, which is light from 6 AM to 6 PM local time and switches at each boundary.

## Materials

On macOS 26, Liquid Glass is for chrome that floats over content: the sidebar, segmented controls, toasts, and floating notices. Reading surfaces, editors, tables, and dialogs stay solid. On earlier systems, and whenever Reduce Transparency is on, the same chrome uses Manor's solid surfaces, so the layout and hierarchy never depend on glass.

## Window and sidebar

The window has a hidden, unified title bar; the system window buttons sit inside the sidebar's top corner, and content runs to the top edge. Manor draws no fake window controls or OS chrome.

The sidebar docks by default and floats as a glass panel on macOS 26, inset from the window edge with corners concentric with the window's; the window buttons and the sidebar toggle share its top row. Collapsed, it appears when you point at the left edge. Rows follow the system sidebar: plum symbols, and a neutral pill with a heavier title for the selected item, never a left-edge accent bar.

## Accessibility

Manor follows the system's accessibility settings throughout: Increase Contrast strengthens text, borders, and hairlines; Reduce Transparency replaces glass with solid fills; and Reduce Motion replaces movement with near-instant fades. Every icon-only control has an accessible name and a tooltip, charts expose their values to assistive technology, keyboard focus is always visible, and every flow works from the keyboard.

## Components

Each button, menu row, property editor, tooltip, date picker, dialog, filter, table, chart legend, empty state, and focus treatment has one shared recipe.

- **Object details are centered dialogs.** Side peeks, drawers, sheets, right-edge panels, and detail rails are not used for object details. Page layouts, the sidebar, inline popovers, menus, and tooltips are separate purposes.
- **Dialogs** use compact property rows with the label in a stable column and the control beside it. Common properties stay visible; conditional ones expand in place inside a scrolling body. Each dialog has a plain title, a close control at the top right, a neutral Cancel, and one primary action. Dismissing unsaved changes asks first, a failed save keeps the draft with an actionable error, and destructive actions confirm when Undo isn't available.
- **Undo over confirmation.** Reversible destructive actions, such as completing or deleting a task or archiving a habit, act at once and offer Undo; confirmations are for actions that can't be undone.
- **Popovers** are their own dismissal layer: Escape and an outside click close the topmost popover first and return focus to its trigger without discarding the parent's draft. Popovers stay on screen and anchor next to the object they edit.
- **Icons** are SF Symbols with accessible names. No emoji as icons, no mascots or characters.
- **Density matches data volume.** Collections that grow, such as bookmarks, logs, and the problem index, are compact lists or tables, never large card grids. Text never overflows or touches its container; if a label can't fit at 12 points, it moves.

Module history views share one structure: a month navigator (Left and Right step months while it has focus, and the month name returns to the current month), a hairline summary strip, a 3, 6, or 12-month trend, and a month breakdown. Every module page uses the same segmented view tabs in its header.

## Notes editing

Notes targets rich document editing in Manor's visual language: block handles, slash menus, selection formatting, nested menus, link editors, media controls, and tooltips suited to the content. Recolored default controls don't meet that bar.

Selection and caret survive opening controls. Menus stay anchored to their object and within the screen, and moving between nested menus is dependable by pointer and keyboard. Contextual rows use a stable icon column, a label with an optional description, and a muted trailing shortcut or submenu mark. Block spacing, list indentation, headings, code, tables, and media form one document rhythm, and hover controls never shift text or cover what you're editing. Typing, selection, and repeated editor actions respond immediately.

Alfred blocks in notes render in the document's own typography and colors, and their working state is quiet and honors Reduce Motion.

## Alfred

Alfred's notch card is the one deliberately dark surface in Manor: a black, hardware-style card that springs from the notch and folds back, so it reads as part of the Mac rather than a window. Its type follows Manor's scale, its answer text size is adjustable, and its diagrams and generative UI use the same contrast rules as the rest of the app.

## Motion

Motion explains state and preserves orientation: brief, interruptible transitions for overlays and feedback, springs for panels and for layout that settles after a drag, and no animation delays on typing, keyboard commands, or frequently repeated actions. Streak and freeze indicators may animate briefly when their state changes; they don't loop at rest, and the static and reduced-motion states carry the same meaning.

The Pomodoro timer is a single ring, plum for focus and teal for breaks, with the remaining time in Outfit tabular numerals at its center and small dots for the position in the cycle. The arc moves once a second without easing, like a clock. Completion blooms once and settles.

## Sound and copy

Optional completion sounds are quiet and tactile, reserved for task and habit completion, the end of a Pomodoro session, and rare achievements; never navigation, hover, typing, or errors. Settings has a switch for them.

Product copy is concise and human. It never leaks implementation or specification language, uses no em dashes, and avoids exclamation marks. Mechanics are explained in Settings or contextual help where they inform a decision, and states show through color, weight, and emphasis rather than explanatory text chips.

Keyboard shortcuts follow the platform: Command with a digit switches pages, Command-backslash toggles the sidebar, Command-N creates on pages that create, Command-comma opens Settings, Escape clears a search field before it closes anything, and Space drives the Pomodoro timer. Settings lists every shortcut.

## Verification

A surface ships with its workflows, not only its layout: create and edit paths, property controls, empty, loading, and failure states, long content, keyboard use, and both themes. Signed-in surfaces use real account data and honest empty states. Each change is checked in the running app against Apple's Human Interface Guidelines, as the [testing and QA](arch-components/testing-and-qa.md) slice describes.
