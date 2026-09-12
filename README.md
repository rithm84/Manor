# Manor

_Last updated: 2026-09-09_

Manor brings daily planning, habits, learning, job applications, and personal knowledge into one workspace. It is being rebuilt as a web app that can be used directly or operated by Codex through WebMCP and remote MCP.

Manor provides the productivity interface and durable records. Codex brings conversation, voice, and context from connected sources to help maintain them. The aim is to spend less time organizing the system and more time using what it knows.

**Status: runnable web app with staging verification.** The interface, real backend adapters, transactional commands, durable Notes editing, and agent-tool catalog are implemented. The encrypted Journal builds separately. Production release acceptance is not complete; [architecture status](docs/ARCHITECTURE.md#1-status-and-scope) distinguishes verified flows from outstanding OAuth, deployment, and recovery work.

## The experience

| Area | What it brings together |
|---|---|
| **Home and tasks** | Daily planning, task views, recurring work, connected calendar events, and disposable time blocks. |
| **Habits** | Daily check-offs, progress history, individual streaks, and deliberate recovery after missed days. |
| **Mood and focus** | Quick daily ratings and one evolving synthesis of the day's debriefs. |
| **LeetCode** | Curriculum progress, solve and review attempts, saved solutions, and mistakes to revisit. |
| **Jobs** | A browsable internship catalog, an application pipeline, stage history, and resume versions. |
| **Notes and knowledge** | Rich documents, attachments, captured material, X bookmarks, and retrieval across saved content. |
| **Journal** | A separate encrypted writing surface, kept outside agent access. |

Scheduled weekly reviews will bring patterns and unfinished work back into view. The [design charter](docs/DESIGN.md) sets a Mixpanel-informed aesthetic, Notion-style Notes editing, and deliberately designed light and dark modes.

## Working with Codex

The intended workflow is to keep Manor open in Codex's browser and use either the interface or conversation to work with the same records. For example:

- “Add this job posting to my applications and attach the resume I used.”
- “Read my email and update the tasks that need attention.”
- “Let's debrief today, then update my daily synthesis.”

The shared catalog exposes domain operations for finding records, making precise changes, and inspecting saved results. Native WebMCP host behavior and real remote OAuth authorization still require verification. When context comes from email or another connected source, Codex uses its own integration and then invokes the relevant Manor operation.

Backend jobs own ingestion and embeddings. Scheduled ChatGPT Work tasks generate weekly reviews and save them through remote MCP without an open Manor tab. The Journal has a separate privacy boundary and does not participate in synthesis, search, or agent tools.

## What is in this repository

The repository includes the React web app, a BlockNote editor with protected drafts, shared domain types and tool contracts, Supabase migrations and workers, anonymous fixtures, and tests. The separate Journal package implements browser encryption. Recovery tools use restic and rclone for encrypted snapshots and isolated file restoration.

The stack is React, TypeScript, and Vite on Vercel, with Supabase for backend services and TanStack Query for browser server state. The [architecture document](docs/ARCHITECTURE.md) defines the boundaries and contains editable Excalidraw diagrams.

Before release, complete production data import, real Google and remote OAuth authorization, unattended weekly-review verification, and a remote database-plus-files restore rehearsal. Staging checks and buildable code do not establish production readiness.

## Working locally

Start with the [web app guide](app/README.md) for connection settings, development, and verification. `npm --prefix app run dev` starts the app on port 5173; the independent Journal uses port 5180. The production web build writes `app/dist/`. The [recovery guide](tools/recovery/README.md) covers backup credentials, daily scheduling, and isolated restore requirements.

Documentation diagrams live in `docs/diagrams/` as editable `.excalidraw` scenes alongside their exported SVGs. To regenerate the SVGs using the local export tool and an installed Google Chrome browser:

```sh
npm --prefix tools/diagrams ci
npm --prefix tools/diagrams run render
```

## Documentation

| Document | Purpose |
|---|---|
| [PRD](docs/PRD.md) | Product scope, business rules, delivery priorities, and open product decisions. |
| [Architecture](docs/ARCHITECTURE.md) | Technical design, data flow, deployment, migration, and recovery. |
| [Design charter](docs/DESIGN.md) | Visual direction, typography, component treatment, and interaction principles. |
| [Redesign report](docs/REDESIGN-REPORT.md) | Notion and Mixpanel flow analysis, reference crops, implementation gaps, and design proposals. |
| [Web app guide](app/README.md) | Package setup, verification commands, and current implementation limits. |
| [Agent guide](AGENTS.md) | Repository layout, working conventions, and available skill groups. |
