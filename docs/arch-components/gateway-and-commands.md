# Gateway and commands

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

The gateway is the app's only transport to the backend, and `manor_command` is the only write path for app and agent alike. The following diagram shows one write, including a retry.

![The command path: a page or MCP tool sends an operation, input, and expected revision to the gateway, which calls manor_command with a command ID; Postgres authorizes, validates, and checks the revision, then writes rows, action events, and a receipt in one transaction and returns the committed record, or returns a conflict with current state; a retry with the same command ID returns the stored receipt; the gateway then pulls the mirror and publishes the touched tables.](../diagrams/svg/commands-path.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## The gateway

`Gateway` (`ManorKit/Core/Gateway.swift`) is bound to one account and offers five calls:

| Call | Does |
|---|---|
| `rows(_:where:)` and `row(_:key:serverFilters:)` | Reads a table from the local mirror while it serves that table, otherwise from Postgres with owner scoping and deterministic ordering by primary key, a thousand rows a page |
| `command(_:_:id:)` | Runs a named operation through `manor_command` and returns its receipt |
| `rpc(_:_:)` and `derived(_:day:)` | Calls a Postgres function; `derived` serves an account-derived result such as `manor_habits_state` from the mirror's cache while its cursor and day still match |
| `function(_:_:)` | Invokes an Edge Function |
| `changes(of:)` | A stream of changed table names that pages subscribe to |

Every request updates `isConnected`: a request that got no answer marks the gateway offline, and the next one that did marks it online. Pages use that to show offline state without guessing from the network path.

## Commands

A command sends `p_command_id`, `p_operation`, and `p_input`. The input carries the target IDs, typed changes, and `expected_revision` where the record exists. The server validates and authorizes, checks the revision, writes the rows, field-level action events, and a receipt in one transaction, and returns the receipt with the committed record or records. The gateway checks that the receipt names the same command ID and operation before accepting it.

- **Retries.** The gateway retries twice, with backoff, on a serialization failure (`40001`) or a request that got no answer, reusing the command ID. The server replays the stored receipt for a repeated ID, so a retry never applies twice. Callers that protect work on disk, such as Notes, use the draft's mutation ID as the command ID so a retry after a relaunch is idempotent too.
- **Conflicts.** A moved revision returns a conflict carrying enough current state to resolve it; nothing is overwritten silently.
- **After commit.** The gateway asks the mirror to pull, then publishes the tables the operation can touch (`ManorTables.affected(by:)`, always including `action_events`), or every table when the operation is unknown. It also records the command ID, so the Realtime echo of its own write doesn't start a redundant pull.

Database-only mutations are transactional RPCs inside `manor_command`. Work that crosses into Storage or providers uses Edge Functions and durable jobs, and returns an accepted job or file state when completion is asynchronous. Related mutations use explicit atomic batches; independently processed bulk items report each item's result rather than disguising partial success as an atomic outcome.

## Receipts and history

Receipts and history serve different purposes. A receipt resolves uncertain delivery: it holds the original outcome and committed revision, and a newer cache never regresses to an older receipt. Action history explains meaningful changes for analysis. The [data and lifecycle](data-and-lifecycle.md) slice owns history, Trash, and purge.

## Reads and freshness

Pages never reload a whole module on a local change. Each store subscribes to the tables it shows and reloads from the gateway when any of them changes, whether from its own command, a mirror pull, or another device. Committed records returned by a command are applied to the page's state at once; optimistic visual state, where used, stays distinguishable from confirmed saving.
