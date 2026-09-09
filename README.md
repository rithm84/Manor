# Manor

_Last updated: 2026-09-09_

Manor brings daily planning, habits, learning, job applications, and personal knowledge into one workspace. It is being rebuilt as a web app that can be used directly or operated by Codex through WebMCP.

Manor provides the productivity interface and durable records. Codex brings conversation, voice, and context from connected sources to help maintain them. The aim is to spend less time organizing the system and more time using what it knows.

**Status: foundation for the web rebuild.** This checkout contains a buildable React UI library and reusable domain logic. It is not yet a runnable or deployed web application. The desktop runtime has been removed; the new web services and agent tools are still to be implemented.

## The planned experience

| Area | What it brings together |
|---|---|
| **Home and tasks** | Daily planning, task views, recurring work, connected calendar events, and disposable time blocks. |
| **Habits** | Daily check-offs, progress history, individual streaks, and deliberate recovery after missed days. |
| **Mood and focus** | Quick daily ratings and one evolving synthesis of the day's debriefs. |
| **LeetCode** | Curriculum progress, solve and review attempts, saved solutions, and mistakes to revisit. |
| **Jobs** | A browsable internship catalog, an application pipeline, stage history, and resume versions. |
| **Notes and knowledge** | Rich documents, attachments, captured material, X bookmarks, and retrieval across saved content. |
| **Journal** | A separate encrypted writing surface, kept outside agent access. |

Scheduled weekly reviews will bring patterns and unfinished work back into view. The visual redesign will use Mobbin references, with the existing [design charter](docs/DESIGN.md) as its starting point.

## Working with Codex

The intended workflow is to keep Manor open in Codex's browser and use either the interface or conversation to work with the same records. For example:

- “Add this job posting to my applications and attach the resume I used.”
- “Read my email and update the tasks that need attention.”
- “Let's debrief today, then update my daily synthesis.”

These are target workflows. WebMCP will expose comprehensive domain operations so Codex can find records, make precise changes, and see their saved results. When context comes from email or another connected source, Codex uses its own integration and then invokes the relevant Manor operation.

Background ingestion and review generation belong to the backend so they can run independently of an open conversation. The Journal has a separate privacy boundary and does not participate in synthesis, search, or agent tools.

## What is in this repository

The retained foundation includes React routes and components, a BlockNote editor, shared types and validation, domain calculations, anonymous fixtures, and tests. It also includes existing database migrations, jobs ingestion code, and reusable X bookmark parsing.

The target stack is React, TypeScript, and Vite on Vercel, with Supabase for backend services and TanStack Query for browser server state. The [architecture document](docs/ARCHITECTURE.md) defines the boundaries and contains editable Excalidraw diagrams.

Work still required before release includes the web entry point, account flows, shared transactional operations, WebMCP registration, cache updates, protected browser drafts, file lifecycle and recovery, background jobs, and the isolated Journal. Existing migration files describe historical deployments; they do not establish that the target architecture is implemented.

## Working locally

Start with the [UI foundation guide](app/README.md) for installation, typechecking, tests, and build commands. The package currently builds a library into `app/dist/`; it has no development app server. Its view components require explicit service implementations.

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
| [UI foundation guide](app/README.md) | Package setup, verification commands, and current implementation limits. |
| [Agent guide](AGENTS.md) | Repository layout, working conventions, and available skill groups. |
