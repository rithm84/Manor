---
name: manor-import
description: Import Markdown documents with their images and attached files into Manor Notes through the Manor MCP tools. Use when asked to bring a Notion or Obsidian export, a folder of Markdown, or any Markdown file with local assets into Manor.
---

# Import Markdown into Manor Notes

Manor converts Markdown into its native note blocks on the server. Your job is what the server cannot do: find the files the Markdown points at on disk, upload them, and tell Manor which path is which file. The tool that ties it together is `import_markdown_note`.

## Flow

1. **Read the Markdown** and decide the note title (front matter `title`, the first `#` heading, or the file name). If the document starts with a heading that repeats the title, remove that line so it is not shown twice.

2. **Create the note.** Call `import_markdown_note` with a fresh `id` (UUID), `expected_revision: 0`, the title, `folder_id` and `parent_page_id` (or `null`), and the Markdown text. The receipt has `record.revision` and `import.assets`, a list of the local paths the Markdown referenced that have no file yet, each with the `block_id` of the empty block waiting for it. If `import.assets` is empty, you are done.

3. **Locate each asset on disk.** Paths are relative to the Markdown file; Notion exports put them in a folder named after the page, Obsidian vaults may keep them anywhere, so search by file name when the relative path is missing. Never invent a file; if one is not found, report it and leave its block empty.

4. **Upload each file** with its parent set to the note:
   - `prepare_file_upload` with `command_id`, a fresh `id`, `purpose: "note"`, `parent_id: <note id>`, `name`, `mime_type`, `size` in bytes, and the hex `sha256` of the bytes.
   - Send the bytes to the returned `upload_url`: `curl -sS -X PUT "<upload_url>" -H "Content-Type: <mime_type>" --data-binary @<file>`. Files larger than `resumable_chunk_size` go through the TUS `resumable_endpoint` with `upload_token` as the `x-signature` header.
   - `finalize_file_upload` with the same `id`; it returns the ready file. The attachment URL is `manor-attachment://<id>`.

5. **Import again with the mapping.** Call `import_markdown_note` with the same note `id`, `expected_revision` set to the revision from the latest receipt, the same title and Markdown, and `assets` mapping each path exactly as it appears in `import.assets` to its `manor-attachment://` URL. The note's content is replaced with the images and files in place.

For many documents, repeat per document. Sub-pages of a Notion export become notes with `parent_page_id` set to the parent note's id. Links between pages in the export are kept as plain text; there is no cross-note link target to rewrite yet.

## What converts

Headings (levels 1 to 6), paragraphs with bold, italic, strikethrough, inline code, and links, bullet, numbered, and task lists with nesting, quotes, fenced code with language, tables, `$$` math blocks and `$inline$` math, horizontal rules, images (`![]()`, `![[wikilink]]`, `<img>`), and links to local files (PDF, ZIP, audio, video, office documents), which become file blocks once uploaded. `[[Wikilinks]]` become their text. Front matter is removed and returned in `import.front_matter`. `import.notes` lists anything that was kept only as text.

## Rules

- Keep the same `command_id` when retrying a call; use a new one for a new step.
- Do not paste file bytes or `data:` URLs into the Markdown; upload files.
- Do not map a path to anything but a `manor-attachment://` URL returned by `finalize_file_upload`.
- Content the user did not ask to import stays out; import only the documents named.
