# Manor architecture

_Last updated: 2026-11-18_

Manor is a native Mac app backed by one Supabase project per environment. The app reads your account from a copy kept on the Mac and writes every change through one transactional command boundary that agents share. This page maps the system and how its parts relate. The linked component slices under [arch-components](arch-components/) carry the detailed contracts, limits, and failure rules. The [PRD](PRD.md) owns product behavior and vocabulary, and the [design charter](DESIGN.md) owns the visual direction.

## Diagram key

Diagrams across these documents color each node by its role; open **Diagram key** under any diagram to see the roles. An orange dashed arrow is asynchronous or deferred work, a red arrow is a refused or blocked path, and a green arrow is a verified or accepted one.

## System

The system has one durable authority, Postgres behind `manor_command`, and several clients and executors around it. The following diagram shows the parts and who talks to whom.

![Manor's system landscape: you use the Manor app and Alfred, which share one process on your Mac; the app keeps an on-device mirror and drafts, signs in with Supabase Auth, sends commands and feed pulls to Postgres, and calls Edge Functions for problem runs and uploads; agent hosts reach the manor-mcp Edge Function; Edge Functions run code in Blaxel sandboxes; cron workers pull from Google, X, and SimplifyJobs; Alfred calls OpenAI and Deepgram with your own keys; the app checks GitHub Releases for signed updates.](diagrams/svg/architecture-system-landscape.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](diagrams/svg/_key.svg)

</details>
<p></p>

The Manor app is a SwiftUI and AppKit process. It owns presentation, local protection of unsaved work, and a SQLite mirror of the account; it owns no business rules that the server doesn't also enforce. Supabase owns authentication, authoritative rows, private files, change feeds, scheduled work, and the Edge Functions that hold secrets. There is no second general-purpose API server.

Agents never reach Postgres directly. They call the `manor-mcp` Edge Function with a scoped OAuth token, and every tool runs the same named operations the app's commands run. Alfred, which shares Manor's process, calls its model providers directly with keys you supply and doesn't touch account data.

### Implementation stack

| Layer | Technology |
|---|---|
| App shell, modules, design system | Swift 6 toolchain, SwiftUI and AppKit, macOS 15 and later, Liquid Glass on macOS 26 |
| Core library (`ManorKit`) | Domain types and rules, the gateway, the local mirror on GRDB and SQLite, files, auth through `supabase-swift` |
| Alfred | A separate Swift target with no package dependencies and no dependency on `ManorKit`; it links ScreenCaptureKit, AVFoundation, and Carbon |
| Notes rendering extras | `swift-markdown` for Markdown, a vendored SwiftMath for equations |
| Backend | Supabase Postgres, Auth, Storage, Realtime, Cron, and Deno Edge Functions; migrations in `supabase/migrations/` |
| Agent transport | The MCP TypeScript SDK in the `manor-mcp` Edge Function, with OAuth 2.1 from Supabase Auth |
| Code execution | Blaxel sandboxes with a pinned toolchain image and Bubblewrap jails |

### Component map

| Area | Detailed architecture |
|---|---|
| The Mac app | [App shell and navigation](arch-components/app-shell-and-navigation.md), [design system](arch-components/design-system.md), [auth and deep links](arch-components/auth-and-deep-links.md) |
| Data path | [Gateway and commands](arch-components/gateway-and-commands.md), [local mirror and sync](arch-components/local-mirror-and-sync.md), [data and lifecycle](arch-components/data-and-lifecycle.md), [files and uploads](arch-components/files-and-uploads.md) |
| Modules | [Notes editor and document format](arch-components/notes-editor.md), [Notes drafts and saves](arch-components/notes-drafts-and-saves.md), [problems library and execution](arch-components/problems.md), [Tracking and Pomodoro](arch-components/tracking.md), [Jobs](arch-components/jobs.md) |
| Assistants and agents | [Alfred](arch-components/alfred.md), [agents and MCP tools](arch-components/agents-and-mcp-tools.md) |
| Operations | [Background jobs and integrations](arch-components/background-jobs-and-integrations.md), [backups and recovery](arch-components/backups-and-recovery.md), [releases and updates](arch-components/releases-and-updates.md), [testing and QA](arch-components/testing-and-qa.md) |

## Component relationships

### Reads come from the Mac, writes go to the server

A page reads through the [gateway](arch-components/gateway-and-commands.md), which answers from the [local mirror](arch-components/local-mirror-and-sync.md) once the mirror holds a current copy and from Postgres before that. The mirror stays current by poke then pull: launch, focus, the network returning, a one-minute timer, a Realtime insert on `action_events`, or this device's own command starts a pull of the account's change feed. Nothing is written to the mirror except what the server returns.

Every write is a named operation through `manor_command`, with a command ID that makes retries idempotent and an expected revision that turns a concurrent edit into a conflict instead of an overwrite. The receipt carries the committed record; the gateway then pulls and tells subscribed pages which tables changed.

### Unsaved work is protected before it is sent

Notes and code drafts are written to per-environment SQLite stores on the Mac before the app claims protection, then saved in order per document. Notes merges a moved revision by block and asks only when the same block changed on both sides. Uploads are journaled, resumed with TUS, and verified on the server before they become attachable. Sign-out, update installs, and account switches all wait on the same guards. The [Notes drafts](arch-components/notes-drafts-and-saves.md), [problems](arch-components/problems.md), and [files](arch-components/files-and-uploads.md) slices own those contracts.

### People and agents authenticate differently and meet at row-level security

You sign in with Google through a system authentication session that returns on the build's URL scheme; a new account must first pass the signup gate. Agents complete OAuth 2.1 with Supabase Auth, and the consent step opens Manor through a static bridge page so you approve inside the app. Both end at owner-scoped row-level security and the same operation catalog. The [auth and deep links](arch-components/auth-and-deep-links.md) slice owns the flows.

### Code runs in sandboxes the app never holds credentials for

The `problem-runner` Edge Function issues editor sessions, queues and grades submissions, and talks to Blaxel. The app's code editor connects to the account's editor sandbox over WebSocket with a short-lived preview token for language-server features, and polls submissions until they settle. Hidden tests never reach the app, and expected answers never reach the app or the jail. The [problems](arch-components/problems.md) slice owns the execution contract.

### Alfred is a guest in Manor's process

Alfred starts when Manor finishes launching and stops when it terminates. It owns its overlay panel, menu bar item, hot keys, capture, transcription, and answers, and the app shell owns only the bridge: the Settings section, reopen handling, and the quit rule that keeps Alfred alive in Prep mode. The [Alfred](arch-components/alfred.md) slice owns its runtime.

### Background work runs without the Mac

Supabase Cron drives calendar and X sync, embeddings, problem-run recovery, maintenance, and jobs ingestion, and a hosted ChatGPT task writes the weekly review through MCP. None of it depends on an open Manor window. The [background jobs](arch-components/background-jobs-and-integrations.md) slice owns the schedules.

## Environments

Staging and production are separate Supabase projects with independent accounts, rows, files, secrets, integration tokens, and queues. Each pairs with its own app identity, so both install side by side and a link for one never opens the other.

| | Production | Staging |
|---|---|---|
| App name | `Manor` | `Manor Staging` |
| Bundle identifier | `app.manor.desktop` | `app.manor.desktop.staging` |
| URL scheme | `manor` | `manor-staging` |
| Update feed | Latest GitHub release | The rolling `staging` prerelease |

A build carries its Supabase URL, publishable key, URL scheme, environment, update feed, and update public key in `Info.plist`, written by the build script from `macos/config/<environment>.env`, which git ignores. An unbundled development run reads `MANOR_SUPABASE_URL`, `MANOR_SUPABASE_KEY`, and `MANOR_URL_SCHEME` from its environment instead. Only publishable values ship in the app; service keys and provider credentials stay in Edge Function secrets.

Staging holds synthetic data, and staging jobs never use production integration accounts. Migrations are rehearsed in staging, then applied to production before the compatible release is published. Code and database roll back separately: installing an older release doesn't undo database writes.

## Active provider lookup

| Role | Provider or system |
|---|---|
| Sign-in | Supabase Auth with Google as the only provider; a signup gate and a before-user-created hook |
| Agent authorization | Supabase Auth OAuth 2.1 server; the consent bridge page on GitHub Pages |
| Durable records, feeds, and commands | Supabase Postgres in AWS us-east-2 |
| Private files and the catalog snapshot | Supabase Storage (`manor-files`, `manor-catalog`) |
| Change pokes | Supabase Realtime on `action_events` |
| Scheduled work | Supabase Cron with Edge Function workers |
| Agent endpoint | `manor-mcp` Edge Function |
| Editor sandboxes and grading | Blaxel sandboxes in `us-was-1` (Ashburn, Virginia) |
| Embeddings | OpenAI `text-embedding-3-small`, billed to Manor's server-side key |
| Alfred answers, memory, and Notes writing | Your OpenAI key: GPT-6.1 Terra on the fast tier; GPT-6 Luna routes new topics |
| Alfred transcription | Your Deepgram key, Flux streaming |
| Calendar, bookmarks, and jobs sources | Google Calendar API, X API, SimplifyJobs listings on GitHub |
| Weekly review generation | A scheduled ChatGPT task through remote MCP |
| Releases | GitHub Releases with an Ed25519-signed feed |
| Backups | Supabase daily database backups; restic and rclone for files |

## Status

The production project carries the applied migrations over the preserved account data, the twelve Edge Functions, the five `manor-*` schedules, Google-only Auth with both hooks, and the OAuth server. The native app replaces the earlier webview app against the same backend, schema, and tools.

Open items:

- The staging Google OAuth client rejects the staging Supabase callbacks, so staging sign-in and calendar consent are verified up to Google's page; staging sessions come from `scripts/staging-session.sh`.
- Hosted ChatGPT registration and an unattended weekly review run against production are unverified.
- The production X account needs reconnecting; its legacy token is rejected.
- Independent file backup storage credentials, the scheduled backup, and a full remote database-plus-files restore rehearsal are outstanding.
- Builds are signed with the self-signed Manor Signing certificate, not a Developer ID, and are not notarized, so a first install needs Gatekeeper approval.

The exact migration inventory is in [`tools/recovery/current-status.json`](../tools/recovery/current-status.json). A deployment existing is not evidence that a check passed; the [testing and QA](arch-components/testing-and-qa.md) slice describes how changes are verified.
