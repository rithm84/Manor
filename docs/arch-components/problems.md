# Problems library and execution

_Last updated: 2026-11-21_

[Back to Manor architecture](../ARCHITECTURE.md)

Problems has three parts: the library index, read from the local mirror; the solving workspace, with a native code editor backed by remote language servers; and graded execution in sandboxes. The following diagram shows the workspace's connections.

![Problems execution: the native code editor protects every keystroke in ProblemCodeDrafts.sqlite and saves drafts with save_problem_draft; it asks the problem-runner Edge Function in us-east-1 for an editor session, receives a preview token and socket URLs, and speaks LSP over WebSocket to the account's editor sandbox; Run and Submit call execute, and the editor polls the submission; problem-runner claims and settles work in Postgres, runs the program and inputs in a jailed grading sandbox, and runs special checkers in a judge sandbox that never holds submitted code; all sandboxes run in Blaxel us-was-1.](../diagrams/svg/problem-execution.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## Data model

`leetcode_problems` holds both the shared catalog and custom problems, keyed by a globally unique `id`. Existing IDs, including the 150 legacy `neetcode-*` IDs and the importer's deterministic UUIDs, keep their values so attempts keep their references. A null `user_id` marks a catalog problem; an account ID marks that account's custom problem (`source_type = 'custom'`), and a problem never changes sides.

- **Content.** `problem_content_versions` stores immutable statements, examples, hints, solutions, starter code, and an optional typed interface, with the owner copied by a trigger. `grading_version` names the latest testset for the current content.
- **Labels.** Topics come from a closed, two-level vocabulary (`ManorKit/Domain/Problems/ProblemTopics.swift` in the app, mirrored by the import tooling): categories hold patterns, problems store patterns only, and a category in a filter matches any of its patterns. Tags carry only source evidence facets (`Round:`, `Role:`, `Employment:`, `Technology:`), and `source_metadata` keeps reported recency with its precision, ranges, frequency, counts, and dataset provenance.
- **Practice.** `problem_practice` holds account status, so a shared row carries no account state. The displayed status is solved when the account has an attempt, otherwise the practice status, otherwise unattempted. `saved_problem_views`, `leetcode_attempts`, and `leetcode_notes` (mistakes) are account-owned.
- **Testsets** are private, keyed by problem and content version, readable only by the runner.

### Who writes what

| Writer | Catalog problems | Custom problems |
|---|---|---|
| The app | None | None |
| Agents through `manor_command` | Refused with `42501` | `save_problem`, `import_problems`, `merge_problem_duplicates`, `unmerge_problem_duplicate`, scoped to the caller |
| Operator tooling as the service role | `manor_private.catalog_command`: import, save, merge, unmerge, and `delete_problem` | None |

`catalog_command` serializes catalog writes under one advisory lock and records a receipt per command ID, so a retried import replays its response. A catalog import whose ID matches a custom problem fails rather than overwriting it. `delete_problem` removes one to 100 catalog problems with their versions, testsets, and every account's attempts, submissions, drafts, and practice rows, and records the attempt removals in each account's history. The import, snapshot, and duplicate-merge tooling lives in `tools/problem-import/`; the [local mirror](local-mirror-and-sync.md#the-shared-catalog) slice covers how the catalog reaches the Mac.

### Duplicates

Duplicates use a flat canonical relationship with at most 100 retained sources. A canonical problem and its sources share an owner and a kind; a stock problem is never a source. Merge and unmerge keep every row, source key, content version, title, and reporting evidence. A merged source's attempts, submissions, drafts, and editor sessions stay in place and are ignored, and row locks and practice-write triggers stop new work from landing on an alias. In the app, `ProblemGrouping` folds sources under their canonical problem and unions their labels, and refuses to guess when a canonical problem is missing.

## Library

`ProblemLibraryStore` reads the catalog, custom problems, saved views, mistakes, attempts, and practice state through the gateway and reloads when any of them changes. `ProblemLibraryIndex` builds the index off the main thread, and an `NSTableView` builds only visible rows.

- **Filters** combine with AND across properties and OR within one: search, kind, difficulty, topics, companies, tags, collections, source type, content availability, status, and a last-asked date range.
- **Sorting** by name, difficulty, kind, created, updated, or last asked; **grouping** by topic, company, difficulty, kind, or collection; and selectable columns.
- **Saved views** appear as tabs with an unsaved-changes marker and save through `save_problem_view` and `delete_problem_view`.
- **The record panel** shows labels, source details, grouped sources, and dated attempts, edited with `create_attempt`, `update_attempt`, and `delete_attempt`.
- **Mistakes** is a second tab of short notes, saved with `save_mistake` and `delete_mistake`.

Up to 12 open workspaces stay alive per account, and `manor://leetcode/<id>` opens one directly.

## Code editor

The editor is native: `WorkspaceCodeEditor` wraps an `NSTextView` subclass on an explicit TextKit stack with non-contiguous layout, a line-number ruler, the system find bar, auto-indent, bracket pairing, comment toggling, and indenting. Auto-indent adds a level after an opening bracket or a Python colon only in code; inside a string, docstring, or comment the new line keeps its indentation. Automatic text substitutions are off.

- **Highlighting** is a hand-written incremental lexer per language (`ProblemSyntax`) that keeps per-line state and stops re-lexing once a line's end state matches its old value. Sources up to 60,000 UTF-16 units lex on the main thread; longer ones lex in the background.
- **Completion** is a non-activating panel that filters by prefix, then subsequence, and opens on the server's trigger characters or Option-Escape and Control-Space. Before a server connects, it offers language keywords and words from the document.
- **Hover and signature help** show in floating cards after 450 and 120 milliseconds. Each card is a hand-placed panel with a fixed width and a height measured once, never a window that sizes itself from its SwiftUI content: content whose width and height follow each other can keep such a window resizing inside one run-loop turn, allocating without bound. **Diagnostics** draw as dotted underlines for errors, warnings, and information, and are dropped when their document version is stale.

### Language servers

`problem-runner`'s `editor-session` action renews the account's editor lease (`manor_problem_editor_lease`), resumes or creates the account's one editor sandbox, and returns a preview token with one WebSocket URL per language, valid as long as the lease. A lease expires after 30 minutes without an editor request, and the minute cron deletes the expired sandbox. The sandbox receives only code the editor sends, never testsets or solutions.

In the app, `LanguageServerConnection` is a JSON-RPC client over `URLSessionWebSocketTask` with one message per frame and a 16 MiB limit. It uses `initialize`, `didOpen`, full-text `didChange` 120 milliseconds after typing stops, completion, hover, signature help, and cancellation, with a 15-second request timeout. Each language has one document, `file:///workspace/main.<ext>` (`Main.java` for Java), and one connection shared by every editor (`ProblemLanguageServers`). A session younger than five minutes is reused. Each connection sends a small notification every 25 seconds while the window is visible, because Blaxel closes an idle preview socket after about a minute, and closes after 10 minutes unused; an offline server is retried on use at most every 5 seconds.

Inside the sandbox, one bridge serves every language, keeps a server warm per language across connections, answers a reconnecting editor's `initialize` from the server's first result, and remaps request IDs so a late answer never reaches the wrong connection. Languages are C++, C, Python, JavaScript, Java, and Go; C is offered only for standard-input problems.

## Code drafts

`CodeDraftStore` is a GRDB database at `Application Support/Manor/<environment>/ProblemCodeDrafts.sqlite`, keyed by account, problem, and language, with the source, content version, cloud revision, and a pending flag. Every keystroke is protected locally; the cloud save is debounced 600 milliseconds and goes through `save_problem_draft` with `expected_revision` and `content_version`, bounded to 256 KiB of UTF-8. The cloud draft loads with `manor_problem_query` (`read_problem_draft`). Cloud saves run one at a time: a save requested while another is in flight waits for it, then sends whatever is still pending, so typing during a slow save ends in exactly one more save.

An unedited local draft takes the cloud copy. Local edits that started from a different cloud revision raise a conflict that offers keeping yours or using the cloud's. A save that failed is resolved by re-reading the cloud copy. Opening a draft re-stamps it with the current content version, and the server rejects a draft for a changed statement. Sign-out waits for pending drafts, then deletes only synced ones.

## Run and Submit

Run and Submit call `problem-runner` with the `execute` action (`mode: run` or `submit`), invoked in AWS us-east-1, beside the Blaxel sandboxes and near the us-east-2 databases. Other actions are `submission` (read one), `submissions` (history), and `editor-session`.

- **Requests** carry a `requestId`; a retry with the same ID returns the same submission. Code is capped at 262,144 characters and custom input at 1 MiB. Unchanged examples run as the testset's public cases; edited cases run as custom input.
- **Single trip.** The function verifies the JWT locally against cached signing keys, and `manor_problem_execute` checks the session, enqueues, and claims the submission in one transaction. The request runs it inline and returns the finished submission when the verdict is ready within 9 seconds; otherwise it returns the submission as it stands and the run continues. The app polls after 300 milliseconds, then less often, settling at once a second.
- **Results** carry the status, verdict (accepted, wrong answer, compile error, runtime error, time limit, output limit, or execution error), case counts, and per-case results with duration and memory.
- **After an accepted submit**, the server inserts a dated attempt with the exact source, once per problem, day, and source, under the submission's command identity. The app reloads history, switches the reader to Submissions, and refreshes attempts and practice.

### Grading

A typed interface declares a function, a design class, or a codec round trip over LeetCode's value and node types. `supabase/functions/_shared/problemInterface.ts` validates interfaces and generates starter code; `problemDrivers.ts` assembles the submission with a hidden driver per language that runs every case in one process, prints each answer behind a per-case marker with its duration, and reports peak memory. Shaped nodes, hidden-API interactors, and concurrency problems have their own judges.

Testsets use exact, trimmed-text, JSON, numeric-tolerance, unordered, deep-unordered, tolerant-JSON, or special checkers. Numeric comparison accepts error up to `max(1, abs(expected)) × 1e-6`; JSON comparisons keep exact integer and decimal digits. Expected answers stay in the trusted worker. A typed submission's cases run in chunks of at most 40 cases and 256 KiB of input, with any case over 64 KiB alone.

Submission feedback discloses the first failing case across all batches, including a hidden one: its input, your output, the expected answer, and printed output or errors. Settlement redacts every other hidden result before storing the owner-readable submission. Compilation errors keep compiler output without case data.

## Sandboxes

Every Manor sandbox runs in Blaxel's `us-was-1` region in Ashburn, Virginia. Each account has three: the editor sandbox, a grading sandbox for submitted programs, and a judge sandbox for special checkers that holds expected answers and outputs but never submitted code. Grading and judge sandboxes are named from a digest of the account, purpose, and runtime image, so provider URLs carry no account ID and a new image starts new sandboxes.

- Submitted programs run in a Bubblewrap jail with a separate network namespace, read-only source and executable mounts, and a fresh temporary filesystem per case. No credentials or expected answers enter the jail. Kernel network isolation is required because proxy settings alone can be bypassed.
- A job writes its request into a root-only directory that the runner deletes after reading; nothing hidden stays in the sandbox after a verdict. A sandbox whose job left a process or file behind, failed, or overran is deleted, so the next job starts clean.
- Between jobs a sandbox stands by without compute and resumes with its filesystem; Blaxel deletes it after an hour idle, and the worker replaces one about to expire.
- The pinned runtime image (`tools/problem-runner/image`) carries prebuilt standard libraries and precompiled headers so each compile is fast.

Leases, bounded batches, retries, and explicit failures keep execution resumable, and the minute cron recovers unfinished work.
