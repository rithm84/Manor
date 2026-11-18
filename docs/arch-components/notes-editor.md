# Notes editor and document format

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Notes stores each page as Manor's block document format and edits it with a native AppKit editor. The [Notes drafts and saves](notes-drafts-and-saves.md) slice covers how edits reach the server.

## Document format

A page's content is `note_pages.content_json`: a JSON array of top-level blocks, decoded by `NoteDocumentCoding` in `ManorKit/Domain/NoteDocument/`. The same JSON travels through the server, the mirror, version history, and the MCP tools, so agents read and edit exactly what the editor stores.

- **Blocks** have the shape `{id, type, props, content?, children?}`. Any other key is kept.
- **Block IDs** are lowercase UUIDs, stable across edits. Missing IDs are filled once before a page is protected or created; duplicates and pastes get fresh IDs.
- **Inline content** is a list of text runs `{type:"text", text, styles}`, links `{type:"link", href, content}`, page mentions `{type:"pageMention", props:{pageId, title}}`, and inline math `{type:"math", content}`.
- **Styles** are bold, italic, underline, strike, code, text color, and background color. Colors are named (default, gray, brown, red, orange, yellow, green, blue, purple, pink) or any stored CSS color.
- **Tables** store `{type:"tableContent", columnWidths, headerRows, headerCols, rows:[{cells:[…]}]}`, where each cell has inline content and props for span, colors, and alignment.
- **Columns** are a `twoColumns` block with a `ratio` prop (25 to 75 percent) whose children are `noteColumn` blocks; `columnList` and `column` with optional width weights are also read. Older documents that stored column content as serialized props are normalized on load and rewritten only after an edit.
- **Tabs** are a `documentTabs` block whose children are `documentTab` blocks with a `title` prop. The active tab is view state and isn't stored.

The block types are `paragraph`, `heading`, `bulletListItem`, `numberedListItem`, `checkListItem`, `toggleListItem`, `quote`, `callout`, `codeBlock`, `mathBlock`, `divider`, `table`, `image`, `video`, `audio`, `file`, `tableOfContents`, `webBookmark`, `webEmbed`, `twoColumns`, `noteColumn`, `columnList`, `column`, `documentTabs`, and `documentTab`. The `/alfred` command adds an `alfred` block (see [Alfred blocks](#alfred-blocks)).

**Conversion is lossless.** Unknown block types, props, keys, inline items, and styles are preserved. A block you didn't edit writes back its stored content verbatim; an edited block writes the canonical shape. The stored array has no schema version of its own; the only versioned format is the export file `{"format":"manor-note","version":1,"title","content"}`.

## Editor structure

The editor lives in `Manor/Modules/Notes/Editor/`.

- **`NoteEditor`** is the SwiftUI entry point. It takes the blocks, the document ID, and the external revision, and reports the whole block array back once per run-loop turn.
- **`NoteEditorController`** owns the block model and every edit, along with one undo manager that stores whole-document snapshots with focus, 200 levels deep. Typing coalesces into one undo step across pauses shorter than 1.5 seconds, up to 10 seconds.
- **`NoteCanvasView`** is a custom `NSView` inside a scroll view. It creates views only for blocks near the visible area and owns block selection, rubber-band selection, the hover handle with add and drag, and drag-to-move, including dropping beside a block to wrap both in two columns.
- **`NoteLayoutEngine`** lays out the whole document with TextKit measurement.
- **`NoteTextView`** is one `NSTextView` per text block, table cell, and equation source. Styles are text attributes; mentions and inline math are attachment atoms.

Every listed type has a view. A block type the editor doesn't know, or a known block whose content didn't parse, shows as a quiet placeholder and stays in the note unchanged.

## Editing features

- **Slash menu:** text, three heading levels and toggle headings, bulleted, numbered, to-do, and toggle lists, quote, divider, callout, code block, table, table of contents, two columns, tabs, block and inline equations, image, video, audio, file, web bookmark, and web embed. `@` opens page mentions.
- **Block menu:** turn into, color, callout style, edit or replace media, header row and column, duplicate, copy, copy link to block, move to another note, move up or down, and delete.
- **Markdown shortcuts:** `#` through `######`, `-`, `*`, `+`, `[]`, `[x]`, `>`, `$$`, fenced code with a language, `1.` with its start number, and `---`; inline `**`, `__`, `~~`, `` ` ``, and `$`.
- **Formatting toolbar:** a floating panel with turn into, bold, italic, underline, strikethrough, code, link, equation, and colors.
- **Tables:** add and insert rows and columns, delete them, header row and column, cell colors, and alignment.
- **Math** renders with a vendored SwiftMath, cached by source, size, and color; a block equation shows its source while you edit it.
- **Code** is highlighted by a regular-expression highlighter for comments, strings, numbers, and keywords, skipped for plain text and very long blocks.
- **Media:** images with captions, alt text, crop, and focal point; audio and video with the system player; file cards; web bookmarks; and embeds in a web view restricted to `http` and `https`.
- **Clipboard:** copying blocks writes Manor's block JSON on custom pasteboard types plus Markdown as plain text. Paste accepts Manor blocks, rich text, Markdown, file URLs and images (which upload), and a URL over a selection becomes a link.
- **Find in note** (`NoteFind`) matches case-insensitively within a block or cell and never changes text.

## Versions and suggestions

`NoteReviewDialog` serves three modes from the editor's menu. **Version history** lists `note_versions` for seven days and restores with `restore_note_version`, which creates a new revision. **Suggestions** shows each agent suggestion from `note_suggestions` as a before-and-after and resolves them individually or together with `resolve_note_suggestions`. **Compare versions** opens on a real save conflict (see [Notes drafts and saves](notes-drafts-and-saves.md#conflicts)).

## Markdown

`NoteMarkdown` parses and writes Markdown for in-app import, export, and paste. Import takes `.md` and `.markdown` files, or a Manor document file; a leading level-one heading becomes the title. Export writes Markdown, with columns separated by rules and tabs as headed sections, and shows a notice listing what Markdown can't keep; **Export Manor document** writes the lossless `.manor.json` file.

Markdown with local assets is imported by an agent instead. The `import_markdown_note` tool converts Markdown on the MCP host (`supabase/functions/_shared/markdownImport.ts`) into native blocks with fresh IDs and maps local image and file paths to `manor-attachment://` URLs once the agent has uploaded them. The recipe an agent follows is the `manor-import` skill.

## Alfred blocks

`/alfred <request>` creates an `alfred` block whose content Alfred streams through `AlfredWriter`. The block has no children; its props are `source` (Alfred's full output: Markdown with ` ```diagram ` and ` ```ui ` fences), `requests` (the prompts in order), and `model` (provenance). Streaming status is view state and isn't stored. The block renders its source with Alfred's embeddable views (`AlfredContentView`, `AlfredDiagramView`, and `AlfredGenerativeView`) in document typography. A refinement sends the current source and request history and replaces the source with the full revised block; **Turn into regular blocks** unwraps the prose into ordinary blocks and keeps each diagram and generative UI element as its own block. Markdown export writes the latest request as a quote followed by the source, and search indexes the source's prose with the fences removed. This command is in progress; the [Alfred](alfred.md#notes-writer) slice covers the writer.
