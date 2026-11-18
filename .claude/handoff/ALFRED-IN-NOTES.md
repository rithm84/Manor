# /alfred in Notes: owner's spec (for the editor agent, once the Alfred API lands)

## Creating (revised by the owner: a composer, not inline)
- Typing `/alfred` (the slash menu lists "Alfred") and pressing Return opens the **Alfred composer**: a
  centered Manor dialog for writing the request with high fidelity. It has a multi-line prompt field (Return
  sends, Shift-Return adds a line, Escape closes), and accepts images by drag and drop, paste, and a "+" button
  (file picker), shown as removable thumbnails with sizes kept reasonable (downscale large images before
  sending). It shows which note it writes into. Send closes the composer and starts generation in place.
- The generation lands in an **Alfred block** (`alfred`) inserted where `/alfred` was typed. It holds
  everything Alfred generated for that request: prose, diagrams (```diagram), and generative UI (```ui),
  rendered with Alfred's embeddable views inside the block, in document typography, light and dark.
- While the model is thinking (before the first content arrives) the block shows a clean, restrained working
  animation in place (a shimmer or a soft pulsing glyph with the request's first line), honoring Reduce
  Motion. Then content streams into the block live.

## Refining
- To change a result, the owner asks Alfred: the Alfred block shows an "Ask Alfred to change…" control on
  hover or selection that opens the same composer (with images supported), titled for refinement and showing
  the block's earlier requests. Alfred rewrites the block's content in place with the same animation and
  streaming, using the request history and current content as context.
- The block menu also offers: Try again (same request and images), Copy, Delete, and "Turn into regular
  blocks" (prose becomes ordinary blocks; diagrams and generative UI become standalone `diagram` and
  `generativeUI` blocks) for hand-editing. Normal undo restores the previous content as one step.

## Editing a selection with Alfred (very common: "reword this", "make it shorter", "turn into a table")
- Select text inside a block or select one or more blocks, then ask Alfred: an "Ask Alfred" button in the
  floating formatting toolbar (text selection) and in the block menu (block selection), plus a keyboard
  shortcut (Command-J). It opens the same Alfred composer (images supported), labeled for the selection, with
  quick suggestions as one-click chips (Improve writing, Shorter, Longer, Fix spelling and grammar, Simplify,
  Make a list, Make a table, Visualize as a diagram) that fill or send the prompt.
- The result streams into a preview placed directly under the selection (the selection stays highlighted),
  with the same thinking animation first. The preview offers Replace selection (Return), Insert below, Try
  again, and Discard (Escape). Nothing in the note changes until Replace or Insert; either applies as one
  undoable step. Follow-ups ("more casual") refine the preview before applying.
- Replacements keep the document's own structure: prose comes back as ordinary blocks (or inline text for a
  text-range selection inside one block, keeping surrounding text and inline styles), and diagram or ui fences
  become standalone `diagram` and `generativeUI` blocks. This edits regular blocks; it does not create an
  `alfred` block.
- Context sent: the selected content (as Markdown), the note title and nearby text, the request and its images.

## Storage (lossless through the server and the MCP tools)
- `alfred` block props: `source` (the model's full output: Markdown with ```diagram and ```ui fences),
  `requests` (the prompts in order, each with its attached images stored as note attachments: `manor-attachment://` URLs uploaded through the Files service, so they sync and survive), `model` (provenance). Streaming status is transient UI state, not stored.
  No children: the content lives in `source`.
- Markdown export: the latest request as a quote line, then `source` as-is. Search: the prose text of
  `source` (fences stripped) so notes stay searchable; check the server-side text extraction and Markdown
  export in `supabase/functions` handle the new block type (report backend changes to the integrator).

## Behavior
- Escape stops a running generation; a whole insertion or rewrite undoes as one step; errors (no key,
  network) show inline in the block with a retry, never a dialog.
- Context sent: the request with its images, the note title and nearby plain text, and, for refinements, the
  block's current `source` and request history; never screen captures or audio.
- Model: GPT-6.1 Terra on the fast tier (same configuration as the notch app).
- Naming: never mention OpenUI, OpenCluely, BlockNote, or Mixpanel in code, comments, or UI.

## Native block primitives (owner requirement)
- Alfred's output, in Alfred blocks and selection rewrites, becomes Manor's real blocks: headings, paragraphs
  with inline styles and math, bulleted, numbered, and check lists, GFM tables, code blocks, quotes, dividers,
  block math, callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`), toggles
  (`<details><summary>`), plus `diagram` and `generativeUI` blocks for ```diagram and ```ui.
- An Alfred block renders its content with the editor's own native block views (read-only inside the
  block), not Alfred's Markdown renderer, so its tables and lists look and behave like the rest of the note;
  `source` stays the truth for refinement, and "Turn into regular blocks" moves the converted blocks out.
- Streaming conversion is stable: partial tables and lists grow in place, unclosed fences or details wait.
