# Manor Design Charter

_Last updated: 2026-09-10_

This document owns the accepted visual and interaction direction. [PRD.md](PRD.md) owns product behavior; [REDESIGN-REPORT.md](REDESIGN-REPORT.md) contains the Mobbin evidence, component analysis, and proposals still awaiting selection. Shared theme tokens and components implement the selected baseline; complete workflow verification remains required.

## Direction

Use **Mixpanel's smooth, restrained product UI** as the aesthetic baseline and **Notion's document editing and contextual controls** as the interaction reference. Manor chooses its own color scheme. The paper-and-ink identity, grain overlays, handwritten display typography, sketched decoration, and literal sticky-note styling are retired. The supplied references do not authorize copying unrelated Mixpanel analytics workflows or Notion workspace features.

Preserve Manor's high-level layout, especially Home's task kanban alongside a single-column calendar timeline. Redesign Mood & Focus and module history views comprehensively. The tool-only action history remains outside the UI. Follow [PRD §8](PRD.md#8-surfaces) for navigation and centered object details.

Home's calendar matches the width of one kanban column. All five columns grow and shrink together until their shared readable minimum; below that, the board scrolls horizontally. Narrow layouts stack the board and calendar.

Light and dark modes are both required. Design each mode's surfaces, contrast, controls, charts, editor selection, media presentation, and overlays deliberately. Plum and neutral gray are selected. Use muted teal as the working secondary accent for supporting highlights and chart differentiation; its exact treatment remains subject to review on populated screens. Exact theme tokens still need contrast and interaction checks.

## Manor mark

The selected logo is the **Flowing M**: a continuous, rounded monogram with a restrained plum treatment. The canonical standalone asset is `app/public/brand/manor-mark.svg`; `app/src/ui/components/brand/ManorLogo.tsx` renders the same SVG geometry inline for the app sidebar and account surface. Use its established proportions and theme-aware color. Do not introduce alternate marks, sketched treatments, or character imagery.

## Typography and density

Use Outfit for headings and DM Sans for body text, navigation, forms, and other interface controls, with a clear hierarchy of weight, size, and spacing. Both use the SIL Open Font License; self-host the selected font files and retain their license notices. These are Manor's chosen fonts, not a claim to reproduce Mixpanel's proprietary typeface. Handwriting has no role in the new baseline. Monospace remains for code; use tabular numerals for comparable statistics and times.

Keep product UI text at least 12px, with the existing 11px exception only for dense time-grid gutters. Note reading text and line length need their own comfortable scale; compact controls do not justify cramped prose. Growing collections use compact rows or tables. Content uses the page directly, without a padded card enclosing an entire page.

Exact font sizes, spacing, radii, and color values will be chosen from the reference study and tested together. Implement approved values in the shared token system rather than scattering literals through page CSS. The shared values live in `app/src/ui/styles/tokens.css`.

## Light and dark modes

Give canvas, navigation, inset controls, raised surfaces, and overlays distinct roles in each theme. Check disabled, hovered, pressed, selected, focused, loading, and error states independently. A darker surface is not automatically a disabled surface; selected content must remain distinguishable from hover and keyboard focus.

Shared controls use distinct hover and selected fills, with a stronger selected-hover state. Input and checkbox boundaries use the control-border role rather than decorative divider colors. Tinted tags retain a subtle edge derived from their foreground so they remain distinct inside selected rows.

Every semantic family defines its foreground independently from its subtle and strong fills in each theme. Duration, status, priority, completion, warning, and danger pills must keep readable text at the 12px minimum; never derive both text and fill by changing opacity on one source color. Verify text and meaningful control boundaries in both themes at their rendered sizes, including hover, selected, disabled, and focus states.

Choose semantic and categorical chart colors independently from the primary action accent. Preserve each series' identity between themes while tuning its lightness and saturation for readability. Use labels, shapes, strokes, or patterns where color alone cannot carry meaning. Missing data must remain distinct from zero and from an explicitly logged rest day.

Treat photographs, embedded content, code highlighting, selection highlights, and transparent images as content with their own theme behavior; do not apply a blanket inversion. Design and verify both modes with realistic dense and empty states, keyboard focus, and reduced-motion preferences.

## Notes editing

Full note-taking fundamentals and rich-media parity with Notion are the target defined in [PRD §7.7](PRD.md#77-notes). Rebuild the BlockNote-facing controls to match the reference interaction anatomy: block handles, slash menus, selection formatting, nested menus, link editors, media controls, and tooltips. Merely recoloring default controls does not satisfy the requested UX.

Selection and caret positions survive opening controls. Menus remain anchored to their object and within the viewport; keyboard access and pointer movement between nested menus must be dependable. Block spacing, list indentation, headings, code, tables, and adjacent media form one document rhythm. Hover controls must not shift text or cover the content being edited.

Contextual editor rows use a stable icon column, a label with optional description, and a muted trailing shortcut or submenu affordance. Groups have visible breathing room, and hover, keyboard-active, and selected states use neutral semantic surfaces rather than browser-default blue. A nested color, link, or property popup owns Escape first; closing it preserves the text selection and returns control to its parent surface.

Typing, keyboard navigation, selection, and repeated editor actions respond immediately. Dragging has explicit insertion targets and a keyboard-accessible alternative. Durable saving, conflict behavior, and agent editing are specified in [ARCHITECTURE §6](ARCHITECTURE.md#6-notes-drafts-and-editing), not inferred from the appearance of a save indicator.

## Shared components and motion

Use one shared recipe for each button, menu row, property editor, tooltip, date picker, dialog, filter, table, chart legend, empty state, and focus treatment. Adapt Notion's contextual layout within Manor's new aesthetic. Object details remain centered dialogs; sidebar navigation and small anchored controls retain their separate purposes.

Create and detail dialogs use compact property rows with the label in a stable column and the control beside it. Common properties stay visible; conditional or advanced properties expand in place inside a scrolling body. Each dialog has a plain DM Sans title, an obvious top-right close control, a neutral Cancel action, and one primary save action. Dirty dismissal asks before discarding, failed saves keep the draft and show an actionable error, and destructive actions use a separate confirmation when reversal is not immediate.

An anchored popup is a separate dismissal layer from its parent dialog. Escape and outside press close the topmost popup first and restore focus to its trigger; they do not discard the parent draft. Popup content stays within the viewport and may scroll independently when its option set is long.

Every interactive component has hover where applicable, press, focus, disabled, and error treatment. Use consistent Lucide icons and meaningful accessible names; no emoji as interface icons, mascots, or fake OS chrome. Selected sidebar items use a fill and text emphasis, without a left-edge accent bar.

Motion explains state and preserves orientation. Use brief, interruptible transitions for occasional overlays and feedback, with reduced-motion treatment. Avoid animation delays on typing, keyboard-driven commands, and frequently repeated editing actions. The design-engineering skill supplies implementation guidance; screenshot sequences do not establish exact animation timings.

Streak and freeze indicators may animate briefly when their state changes or an achievement is earned. They do not loop continuously at rest. Both the static resting state and the reduced-motion state must communicate the same meaning.

## Sound and copy

Retain the existing optional, quiet completion sounds and appearance setting. Sound is reserved for task/habit completion and rare achievements, never navigation, hover, typing, or errors. Removing the visual paper metaphor does not require adding new audio behavior.

Product copy is concise and human. No implementation or brainstorming captions, em-dashes in UI copy, or excessive exclamation marks. Explain mechanics in Settings or contextual help where they inform a decision. Do not use status labels as a substitute for a legible visual hierarchy.

## Verification and references

Use the supplied Mobbin flows and crops in [REDESIGN-REPORT.md](REDESIGN-REPORT.md) as the starting reference set; obtain additional flows for interactions the archive does not show. Distinguish screenshot observations from proposed behavior and implementation findings. Refer to [NOTION-DESIGN.md](NOTION-DESIGN.md) for earlier interaction research without reviving superseded visual rules.

Verify complete workflows, including empty, loading, failure, long-content, keyboard, and both-theme states. The existing [mock data](../app/src/ui/data/mock.ts) is the canonical showroom story; signed-in surfaces use real account data. The charter defines the target; completed components still require workflow and accessibility verification.
