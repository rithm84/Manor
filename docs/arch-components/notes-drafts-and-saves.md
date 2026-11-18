# Notes drafts and saves

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Notes protects every edit on the Mac before it claims protection, then saves to the server in order, one save per note at a time. The following diagram shows a keystroke's path to a committed revision.

![The Notes save path: an edit updates the block model and is protected in NotesDrafts.sqlite with a base revision and mutation ID; a per-note queue with a 650 millisecond debounce sends one update_note at a time with the mutation ID as command ID and the base as expected revision; an unmoved revision commits and re-bases or clears the draft; a moved revision is merged by block against the base version from note_versions and sent again, unless the same block changed on both sides, which opens Compare versions; a save with no answer leaves the draft protected and retries when the connection returns.](../diagrams/svg/notes-save-path.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## The draft store

`NoteDraftStore` (`ManorKit/Domain/Notes/`) is a GRDB database at `Application Support/Manor/<environment>/NotesDrafts.sqlite`. Every read and write is scoped to the account.

| Table | Holds |
|---|---|
| `note_drafts` | One row per account and note: title, blocks, base revision, mutation ID, protection time, and sequence |
| `note_uploads` | Links from media blocks to their pending uploads, so a reopened note finishes them |
| `note_snapshots` | The account's offline note list, so Notes opens without a connection |

The interface distinguishes protection on the Mac from saving to the cloud. A failure to protect blocks leaving the note.

## Saving

`NotesStore` protects on every edit, chaining protections so they land in order. A new draft keeps the existing base revision, or takes the known revision on its first edit, and gets a fresh mutation ID. That ID is also the `manor_command` command ID, so a retry after a relaunch replays the receipt instead of applying twice.

The cloud save is debounced 650 milliseconds. `NotesService` serializes saves per note, so each one reads the base revision committed by the one before it. It sends `update_note` with `expected_revision` set to the draft's base. When a save commits, newer typing moves onto the new revision and any foreign blocks are merged in, so the cursor and undo history in other blocks survive. The revision a device knows for a note only moves forward; an older read never replaces a newer copy.

Leaving a note waits only for local protection; the save continues in the background behind any save already in flight, while the next note opens. Favorites, moves, Trash, restore, duplication, and block moves apply at once the same way, and the service lands a note's protected draft before any other change to that note goes out. A save that fails after you move on keeps the draft and offers the note back with a retry.

## Conflicts

When a save reports a moved revision, the service re-bases once. It fetches the current page and the `note_versions` row at the draft's base revision, runs `NoteMerge`, and sends the result again.

`NoteMerge` is a three-way merge keyed by top-level block ID:

- Edits to different blocks combine; identical edits and blocks removed on both sides agree.
- When only one side reordered, its order wins; a foreign insertion lands after its nearest surviving predecessor.
- A block changed differently on both sides, a block changed on one side and removed on the other, both sides reordering, or both sides retitling differently is a real conflict.

A real conflict marks the note conflicted and opens **Compare versions**, which shows the cloud copy beside your draft. **Save my version** overwrites the cloud note (the replaced revision stays in history), and **Keep cloud version** discards the draft. A refetch never overwrites unsaved keystrokes.

## Pulls and reloads

The mirror's pulls tell Notes which pages and folders changed. Notes reloads only when a pull carried a folder change, a removal, or a page revision this device doesn't already hold, so the echo of its own save causes no reload.

## Offline and sign-out

Without a connection, drafts are held and resent when `connectionRestored` or a retry fires. Before an explicit sign-out, Notes settles the open note, waits for save chains, and refuses while any draft or pending attachment remains; it then refuses further edits until the session ends. A completed sign-out deletes the offline snapshot only after everything is synced. Session expiry keeps drafts for the same account.
