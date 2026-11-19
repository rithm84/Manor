# Testing and QA

_Last updated: 2026-11-19_

[Back to Manor architecture](../ARCHITECTURE.md)

Manor's verification has four layers: unit tests for pure rules, SQL and Deno suites for the backend contracts, signed-in checks on a staging build, and a QA pass over every flow in the running app. A deployment existing is never evidence that a check passed.

## Unit tests

`swift test` in `macos/` runs two targets:

- **`ManorKitTests`** (Swift Testing) covers the domain rules and data path: task dates, recurrence, buckets, and Master filters; habit streaks, the step ladder, freezes, and history; mood and focus scales and trends; Pomodoro clocks and statistics; jobs flow, feed filters, and presentation; the problem library index, grouping, topics, views, workspace drafts, testcases, and execution polling; settings parsing; the Notes document format, tree operations, find, and Markdown; Notes merge, draft store, save and rebase, and offline snapshots; file policy, checksums, and TUS resume; and the mirror's pull plan, bootstrap, feed application, catalog snapshot verification, and serving rules.
- **`AlfredTests`** (XCTest) covers Alfred's configuration, Markdown, streaming clients, transcript, context, knowledge budget, diagram language, generative UI, chat tabs, and router.

Tests exercise pure logic and real SQLite stores, never a broad mock of the app. The views, AppKit editors, and host wiring are verified by running the app.

## Backend suites

`supabase/tests/` holds transactional SQL suites for commands, tools, Notes, problems, recovery, signup gating, MCP authorization, integrations, Pomodoro, and daily ratings, each run after migrations inside a transaction that rolls back, and Deno tests for origins, Markdown import, embedding text, the course feed parser, and stream checksums (`npm --prefix supabase test`). `tools/problem-runner/` has local driver harnesses, smoke tests, and latency checks for the sandbox runtime.

## Signed-in checks on staging

Signed-in, end-to-end checks run on the staging identity, never production:

1. Build and register a staging bundle with `macos/scripts/build-app.sh staging --debug`.
2. Sign it in without Google with `macos/scripts/staging-session.sh [email]`. The script creates a synthetic Google-provider user directly in the staging database when needed, mints a session from a magic link with the service key, and opens the app with a `manor-staging://auth/callback#…` link. `PRINT_LINK=1` prints the one-time link instead, for a build running on another Mac.
3. Simulate another device by running `manor_command` as the same user through the Management API; the mirror's cursor should advance within seconds.
4. Delete the synthetic user and its rows afterwards.

The script names the staging project directly and reads the Supabase access token from the repository's ignored `.env.local`; it is never pointed at production.

## QA in a remote macOS sandbox

Interface work is verified by running the staging build in a remote macOS sandbox rather than on the owner's Mac, then exercising every flow on each changed page: add, edit, duplicate, delete, undo, collapse and expand, drag, keyboard shortcuts, menus, empty and error states, light and dark, and windowed and full screen. Results are judged against Apple's Human Interface Guidelines, such as confirming or offering Undo for destructive actions, standard shortcuts, disclosure behavior, contrast, and focus. A reported bug is treated as a sample of its class, and the matrix runs again after fixes. `macos/scripts/window-shot.swift` captures a Manor window to a PNG for review.

Performance is measured rather than assumed: launch time, page-switch latency, scrolling, and resident memory with Instruments and memory footprint tools, keeping main-thread work small and collections lazy. Launching with `MANOR_PERF_LOG=<file>` appends the time from process start to the first window and to the signed-in window, and each page switch's time with the process's physical footprint, which works in the remote sandbox where Instruments can't attach. The measured numbers, with their setup and dates, are in [benchmarks](benchmarks.md). The sandbox's remote input sends no pointer-moved events, so a debug build launched with `MANOR_QA_HOVER=1` shows the code editor's hover card wherever the caret lands, as resting the pointer there would. `sudo footprint -p <pid>` and `sudo leaks <pid>` in the sandbox report the app's footprint, its peak, and leaked allocations. A debug build launched with `MANOR_QA_MEMORY_CEILING_MB=<megabytes>` lowers the memory guard's ceiling, and `MANOR_QA_RUNAWAY=1` starts an allocating main-thread loop eight seconds after launch, so the guard and its crash report can be checked there. `AlfredBenchmarkTests` runs Alfred's answer cases against a live provider only when `ALFRED_BENCH_OUT` names an output folder (`ALFRED_BENCH_ENV` points at the file holding the provider key, `ALFRED_BENCH_VARIANTS` lists effort levels), and writes each answer with its timing, token, and template checks there.
