# Design system

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

The design system is the code that implements the [design charter](../DESIGN.md): color roles, type, spacing, motion, materials, and shared components in `macos/Sources/Manor/Design/`. Views use these tokens; page code carries no literal colors, sizes, or durations.

## Color roles

`Palette` defines every color as a named role with independent light and dark values, resolved per appearance through a dynamic `NSColor`. The roles group into:

- **Surfaces:** canvas, paper, soft, hover, selected, selected hover, card, strong, and the sidebar's background, hover, selected, and border.
- **Ink:** ink, body, and muted text; hairlines; the control border; focus and selection.
- **Brand:** primary plum with hover, active, and tint states; the teal secondary; text on primary.
- **Semantics:** completion, warning, error, and frozen information, each with a tint; the streak flame's four tones.
- **Scales:** one tone and tint per Mood and Focus level, from Awful to Great and from Locked Out to Locked In, plus Resting.
- **Due buckets and pills:** Overdue, Today, Tomorrow, and This Week, each with text and fill.

Every text and control pairing is checked for WCAG contrast in both themes: 4.5:1 for text and 3:1 for control edges. Text and fill are separate roles, never one color at two opacities.

The asset catalog's `AccentColor` carries the plum accent, so system controls such as pop-up buttons, checkboxes, and switches match Manor instead of the system blue.

## Accessibility settings

- **Increase Contrast** pulls body text, muted text, hairlines, borders, and the control border toward full contrast and makes them opaque, through a per-role boost in `Palette`.
- **Reduce Transparency** replaces Liquid Glass with the solid fallback fill.
- **Reduce Motion** turns every `Motion` curve into a near-instant fade.
- Icon-only controls carry an accessibility label and a tooltip, selected rows expose the selected trait, and hidden pages are hidden from assistive technology.

## Type

`Typography` and the `Font` extensions define three faces:

| Use | Face | API |
|---|---|---|
| Interface and body text | SF Pro, the system font | `.ui(size, weight:)` |
| Page titles and headings | Outfit, a variable font bundled under its SIL Open Font License | `.display(size, weight:)` |
| Code and code-like values | SF Mono | `.code(size, weight:)` |

The size scale is 12, 13, 14 (body), 15, 16, 17, 22, 28, and 40 points, plus the 11-point time-grid gutter, the only size below 12. Comparable numbers use `.tabular()`, which turns on monospaced digits. Fonts load from the app's `Resources/Fonts`, listed under `ATSApplicationFontsPath`; an unbundled development run registers them from the source tree.

## Spacing, radii, and motion

- **Spacing:** 4, 8, 12, 16, 20, 24, 32, 40, and 48 points (`Space.s1` through `Space.s12`).
- **Radii:** continuous corners of 7 (chips), 10 (controls), 14 (cards), and 20 points (large cards), rounder than the earlier web build to sit beside Liquid Glass.
- **Motion:** an ease-out curve at 140, 160, and 200 milliseconds for presses, fast changes, and ordinary transitions; springs for panels entering and for layout that settles after a drag.
- **Shell metrics:** a 224-point sidebar and a 52-point top bar.

## Materials

`glassSurface(_:fallback:)` draws Liquid Glass on macOS 26 when the build has the macOS 26 SDK, and the solid fallback fill otherwise. `glassGroup()` groups nearby glass shapes so they blend. Glass is for chrome that floats over content: the sidebar, segmented controls, toasts, and floating notices. Reading surfaces and dialogs stay solid. The `manor.solidChrome` default forces the solid look for checking it on macOS 26.

## Shared components

`Design/Components/` holds the shared recipes: buttons and icon buttons, segmented tabs, rows with selected and hover fills, the centered dialog host (`manorDialog`), page headers, empty states, toasts, the brand mark, and the native Markdown renderer used by problem statements and solutions, with code highlighting and SwiftMath equations. Module code composes these instead of drawing its own variants.
