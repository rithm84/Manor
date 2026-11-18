# Background jobs and integrations

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Supabase Cron schedules Manor's background work, and Edge Function workers run it in short, bounded steps that checkpoint and resume. None of it depends on your Mac or an open Manor window. The following diagram shows each schedule and what it runs.

![Background work: every minute, Supabase Cron runs manor-integrations, manor-embeddings, and manor-problem-runner, which drive the integration worker for Google Calendar and X, the embedding worker for changed notes and captures, and problem-runner recovery of unfinished runs and expired editor leases; hourly at 17 minutes past, manor-maintenance runs recurrences, streaks, purge, and cleanup; every six hours at 15 minutes past, manor-jobs runs jobs-ingest for SimplifyJobs; all write Postgres, and the weekly review arrives separately from a ChatGPT scheduled task through remote MCP.](../diagrams/svg/background-work.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

## Execution rules

Queue delivery doesn't make external side effects exactly-once, so workers use idempotency keys, leases, backoff, and explicit terminal failure states. Large batches checkpoint and continue on the next tick. Workers authenticate with dedicated worker credentials and receive only the data and capabilities their job needs. A queued job rechecks the source's lifecycle before it reads or writes, so a purged record is never resurrected.

| Work | Model use |
|---|---|
| Google Calendar sync | None |
| X bookmarks | None; linked content is extracted, not generated |
| Jobs catalog | None; deterministic filtering and deduplication |
| Course calendar feed | None; fetched on request only |
| Embeddings | OpenAI embeddings with Manor's server-side key |
| Maintenance | None |
| Problem execution recovery | None |
| Weekly review | The ChatGPT host's own model; no Manor-hosted generation |

## Integrations

Calendar and X connections start from Settings > Connections through the `integrations` Edge Function and return through `integration-callback` in each environment, separately from the sign-in callback. The callback returns to `<scheme>://settings` with a single-use connection code that the Settings page spends, using the environment's `MANOR_DESKTOP_SCHEME`. X is a confidential web app, matching its server-side token exchange. Refresh tokens and other credentials stay in private tables that clients can't read.

- **Google Calendar** is read-only. The minute worker claims up to sixteen due accounts per tick and processes one event page per connected calendar; a successful run reschedules for the next minute boundary, and provider failures back off exponentially. The twelve-calendar cap across an account's Google connections is serialized in the database: OAuth stores a new account and its calendars atomically and rejects a connection that would exceed the cap, and calendars discovered later beyond it are skipped and reported without interrupting the others. The app reads accounts, calendars, and events from its mirror.
- **X bookmarks** sync incrementally with deduplication and linked-content extraction, in bookmark order. The app reads connection state with `manor_x_status` and can trigger a manual sync.
- **Course calendar feed.** The Canvas feed link is a credential kept in `manor_private`. The `course-feed` function fetches and parses it only when Settings or the `query_course_deadlines` tool asks, for at most 60 days, and stores nothing.

Agent-owned connections such as Gmail and Slack are outside this backend: agents bring their content to Manor through ordinary, source-independent tools.

## Embeddings

The `manor-embeddings` schedule indexes only changed, eligible notes and knowledge entries; the [data and lifecycle](data-and-lifecycle.md#search-and-embeddings) slice covers the index contract. Provider-reported token usage is recorded per request in a private table.

## Maintenance

The hourly maintenance job materializes recurring task occurrences ahead of time, reconciles streak state, cleans up expired records such as scratch blocks, which carry an expiry 48 hours after their scheduled end, and runs the Trash purge after its backup acknowledgement.

## Jobs ingestion

`jobs-ingest` runs every six hours; the [Jobs](jobs.md#ingestion) slice covers its filters.

## Weekly review

A scheduled ChatGPT task runs every Sunday at 10 PM in the saved time zone, reads `get_weekly_review_input`, and saves through `save_weekly_review`; the [agents](agents-and-mcp-tools.md#hosts) slice covers the snapshot contract. A missed or failed run stays visible with an authorized retry for the same period.
