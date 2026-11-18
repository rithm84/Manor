# Manor native QA matrix

Run every row in the sandbox (Manor Staging, signed in as the showroom account), in light and dark, at 1280×800
windowed and in full screen. Record each failure as: page, steps, expected, actual, screenshot path, HIG rule.
Data is synthetic staging data; restore what you change (Undo, or put it back).

## Cross-cutting HIG rules (judge every flow against these)

- Destructive actions (delete, remove, retire, discard) either offer Undo right after (toast with Undo,
  Edit > Undo) or confirm first when undo is impossible; the confirm button names the action ("Delete note"),
  is styled destructive, and Escape cancels.
- Standard shortcuts work where they apply: Return opens or confirms, Escape cancels or dismisses, Delete or
  Backspace removes a selected item, Command-D duplicates, Command-Z / Shift-Command-Z undo and redo,
  Command-F finds, Command-A selects all in lists, Space quick-looks or toggles where meaningful, arrow keys move
  selection, Tab moves focus in dialogs and forms.
- Context menus exist on every object row or card and contain the same actions as hover buttons and menus.
- Disclosure: collapsible sections use a chevron that rotates, remember their state, and expand on click and
  on Right arrow / collapse on Left arrow when focused.
- Feedback: every action shows its result immediately (optimistic) and failures are visible with a retry.
- Focus: visible focus ring on keyboard focus only; focus lands somewhere sensible when a dialog opens
  (first field) and returns to the invoking control when it closes.
- Text: no truncation of meaningful labels at 1280 wide; tooltips on icon-only buttons; 12 pt minimum.
- Contrast: text 4.5:1, control edges 3:1, in both themes; selected vs hover vs focus distinguishable.
- Controls: dropdowns, pickers, date pickers, switches, steppers, segmented controls look intentional in both
  themes and use the plum accent; popovers and menus have correct backgrounds and shadows in dark mode.
- Empty, loading, and error states are designed (a sentence and the one action that fills the space).
- Motion is quick and purposeful; nothing jumps, flickers, or relayouts visibly after appearing.

## Pages and flows

**Shell**: sidebar navigation by click and Command-1..7, Command-comma, Command-backslash collapse and the
hover overlay, full screen (sidebar top inset), window resize to minimum size, update card (if any), sign-out
guard message, toasts with Undo, deep links.

**Home**: Weekly board: create task in each column (Command-N, column New), edit in detail dialog (every
field: title, context create/edit/remove, due date/time, estimate, priority, status, repeats), Save changes
vs close-commits, complete and uncomplete, drag between columns (Today/Tomorrow set date, This Week opens
editor), drag a card onto the timeline, timeline: drag block, drag on empty space to create, block dialog,
duplicate, delete with Undo, skip occurrence, recurring this vs future. Master: search, filter builder,
saved views (save, apply, delete), grouping default by context, Completed toggle, row actions.

**Tracking**: Daily: check off binary and quantized habits (click, Shift-click, keys), Yesterday view and
freezes, mood and focus check-in (each value, change, clear, Resting vs missing), synthesis display, add
habit, edit, pause with Undo, retire with Undo, reactivate from Archived, reorder by drag and keys, detail
dialog. History: month navigation (keys, back to this month), ranges, habit picker, sort, retired toggle,
day editor for mood and focus (past day, add missing day, conflict).

**Pomodoro**: start with label, pause, resume, stop, skip break, completion and next step, Space shortcut
(not inside text fields or dialogs), sidebar badge, preferences dialog, History relabel and delete.

**Problems**: search, each filter menu, Advanced dialog, columns, sort by header, saved views (create,
rename, delete), open problem, details dialog (log a solve, edit, delete attempt), mistakes (add, edit,
delete with Undo). Workspace: reader tabs, typing in the editor (completion, hover, signature, diagnostics),
language switch, Run, Submit, Submissions list colors (Accepted is green), submission detail, custom cases
(add, edit, invalid input), reset code, dividers, full screen, back to library.

**Jobs**: Pipeline: add role (Command-N), edit, drag between columns (draft dialog, Cancel restores),
Mark OA done, delete with Undo, Flow hover. Listings: search, filters, add a listing to the pipeline.
Resume picker: upload, choose, open, remove.

**Notes**: create (Command-N), title then first block, typing, every block type from the slash menu,
tabs, columns, toggles, code (language), tables, images, mentions, find, multi-select list (Shift, Command,
Command-A, Delete to Trash with Undo), favorites, move dialog, duplicate, archive, Trash and restore,
permanent delete, folders (create, rename, delete), version history, import and export, list collapse rail.

**Bookmarks**: search, open a bookmark, remove with confirm, empty states.

**Settings**: every section, theme switching live (System, Light, Dark, Day and night), sounds toggle,
time zone picker, connections states, agents list, keyboard shortcuts reference, sign out.
