# Manor design charter

_Last updated: 2026-09-13_

This page defines Manor's visual and interaction direction. Product behavior is in the [PRD](PRD.md), and the [redesign report](REDESIGN-REPORT.md) holds the Mobbin evidence, component analysis, and proposals still awaiting selection. Shared theme tokens and components implement the selected baseline; complete workflow verification is still required.

## Direction

Mixpanel's smooth, restrained product UI is the aesthetic baseline and Notion's document editing and contextual controls are the interaction reference. Manor has its own color scheme. The paper-and-ink identity, grain overlays, handwritten display typography, sketched decoration, and literal sticky-note styling are retired. The references cover Mixpanel's visual system and Notion's editing UX, not Mixpanel's analytics workflows or Notion's workspace features.

Manor's high-level layout stays, especially Home's task kanban beside a single-column calendar timeline, while Mood and Focus and the module history views are redesigned comprehensively. The tool-only action history stays outside the UI. Navigation and centered object details follow the PRD's [surfaces](PRD.md#surfaces) section.

Home's calendar matches the width of one kanban column. All five columns grow and shrink together until their shared readable minimum; below that, the board scrolls horizontally. Narrow layouts stack the board and calendar.

Light and dark modes are both required, and each mode's surfaces, contrast, controls, charts, editor selection, media presentation, and overlays are designed deliberately. The theme preference is system, light, dark, or day and night, which is light from 6 AM to 6 PM local time and dark otherwise, switching at each boundary. Plum and neutral gray are the palette. Muted teal is the working secondary accent for supporting highlights and chart differentiation; its exact treatment is still under review on populated screens, and the theme tokens still need contrast and interaction checks.

## Manor mark

The logo is the **Flowing M**: a continuous, rounded monogram with a restrained plum treatment. The canonical standalone asset is `app/public/brand/manor-mark.svg`, and `app/src/ui/components/brand/ManorLogo.tsx` renders the same SVG geometry inline for the app sidebar and account surface, at its established proportions and theme-aware color. There are no alternate marks, sketched treatments, or character imagery.

## Typography and density

Outfit is the heading face and DM Sans the face for body text, navigation, forms, and other interface controls, with a clear hierarchy of weight, size, and spacing. Both use the SIL Open Font License; the font files are self-hosted with their license notices. They are Manor's chosen fonts, not a reproduction of Mixpanel's proprietary typeface. Handwriting has no role in the interface. Monospace is for code, and comparable statistics and times use tabular numerals.

Product UI text is at least 12px, with an 11px exception only for dense time-grid gutters. Note reading text and line length have their own comfortable scale; compact controls don't justify cramped prose. Growing collections use compact rows or tables, and content uses the page directly without a padded card around an entire page.

Font sizes, spacing, radii, and color values come from the reference study and are tested together. Approved values live in the shared token system in `app/src/ui/styles/tokens.css`; page CSS doesn't carry literal values.

## Light and dark modes

Canvas, navigation, inset controls, raised surfaces, and overlays have distinct roles in each theme, and disabled, hovered, pressed, selected, focused, loading, and error states are checked independently. A darker surface is not automatically a disabled surface, and selected content stays distinguishable from hover and keyboard focus.

Shared controls use distinct hover and selected fills, with a stronger selected-hover state. Input and checkbox boundaries use the control-border role rather than decorative divider colors. Tinted tags retain a subtle edge derived from their foreground so they remain distinct inside selected rows.

Every semantic family defines its foreground independently from its subtle and strong fills in each theme. Duration, status, priority, completion, warning, and danger pills keep readable text at the 12px minimum; text and fill are never both derived by changing the opacity of one source color. Text and meaningful control boundaries are verified in both themes at their rendered sizes, including hover, selected, disabled, and focus states.

Semantic and categorical chart colors are independent from the primary action accent. Each series keeps its identity between themes while its lightness and saturation are tuned for readability, and labels, shapes, strokes, or patterns carry meaning where color alone can't. Missing data stays distinct from zero and from an explicitly logged rest day.

Photographs, embedded content, code highlighting, selection highlights, and transparent images are content with their own theme behavior, never a blanket inversion. Both modes are designed and verified with realistic dense and empty states, keyboard focus, and reduced-motion preferences.

## Notes editing

Full note-taking fundamentals and rich-media parity with Notion are the target defined in the PRD's [Notes](PRD.md#notes) section. The BlockNote-facing controls match the reference interaction anatomy: block handles, slash menus, selection formatting, nested menus, link editors, media controls, and tooltips. Recolored default controls don't satisfy that target.

Selection and caret positions survive opening controls. Menus stay anchored to their object and within the viewport, and keyboard access and pointer movement between nested menus are dependable. Block spacing, list indentation, headings, code, tables, and adjacent media form one document rhythm, and hover controls never shift text or cover the content being edited.

Contextual editor rows use a stable icon column, a label with optional description, and a muted trailing shortcut or submenu affordance. Groups have visible breathing room, and hover, keyboard-active, and selected states use neutral semantic surfaces rather than browser-default blue. A nested color, link, or property popup owns Escape first; closing it preserves the text selection and returns control to its parent surface.

Typing, keyboard navigation, selection, and repeated editor actions respond immediately. Dragging has explicit insertion targets and a keyboard-accessible alternative. Durable saving, conflict behavior, and agent editing are specified in the architecture's [Notes drafts and editing](ARCHITECTURE.md#notes-drafts-and-editing) section, not inferred from a save indicator.

## Shared components and motion

Each button, menu row, property editor, tooltip, date picker, dialog, filter, table, chart legend, empty state, and focus treatment has one shared recipe, adapting Notion's contextual layout to Manor's aesthetic. Object details are centered dialogs; sidebar navigation and small anchored controls keep their separate purposes.

Create and detail dialogs use compact property rows with the label in a stable column and the control beside it. Common properties stay visible; conditional or advanced properties expand in place inside a scrolling body. Each dialog has a plain DM Sans title, an obvious top-right close control, a neutral Cancel action, and one primary save action. Dirty dismissal asks before discarding, failed saves keep the draft and show an actionable error, and destructive actions use a separate confirmation when reversal is not immediate.

An anchored popup is a separate dismissal layer from its parent dialog. Escape and outside press close the topmost popup first and restore focus to its trigger; they do not discard the parent draft. Popup content stays within the viewport and may scroll independently when its option set is long.

Every interactive component has hover where applicable, press, focus, disabled, and error treatment. Icons are consistent Lucide icons with meaningful accessible names; there are no emoji as interface icons, no mascots, and no fake OS chrome. Selected sidebar items use a fill and text emphasis, without a left-edge accent bar.

Motion explains state and preserves orientation: brief, interruptible transitions for occasional overlays and feedback, with reduced-motion treatment, and no animation delays on typing, keyboard-driven commands, or frequently repeated editing actions. Screenshot sequences don't establish exact animation timings.

Streak and freeze indicators may animate briefly when their state changes or an achievement is earned. They do not loop continuously at rest. Both the static resting state and the reduced-motion state must communicate the same meaning.

## Sound and copy

The optional, quiet completion sounds and their appearance setting stay. Sound is reserved for task and habit completion and rare achievements, never navigation, hover, typing, or errors. Retiring the paper metaphor added no new audio behavior.

Product copy is concise and human, with no implementation or brainstorming captions, no em dashes, and no excessive exclamation marks. Mechanics are explained in Settings or contextual help where they inform a decision, and status labels never substitute for a legible visual hierarchy.

## Verification and references

The Mobbin flows and crops in the [redesign report](REDESIGN-REPORT.md) are the reference set, extended with additional flows for interactions the archive doesn't show, and screenshot observations are kept distinct from proposed behavior and implementation findings. [NOTION-DESIGN.md](NOTION-DESIGN.md) holds the earlier interaction research; its visual rules are superseded.

Complete workflows are verified, including empty, loading, failure, long-content, keyboard, and both-theme states. The [mock data](../app/src/ui/data/mock.ts) is the canonical showroom story, and signed-in surfaces use real account data. The charter defines the target; completed components still need workflow and accessibility verification.
