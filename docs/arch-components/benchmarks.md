# Benchmarks

_Last updated: 2026-11-19_

[Back to Manor architecture](../ARCHITECTURE.md)

This page records Manor's measured launch times, page-switch latency, memory footprint, upload recovery, and contrast checks, with the setup each number came from. How the app is measured is described in [testing and QA](testing-and-qa.md#qa-in-a-remote-macos-sandbox). When a change moves one of these numbers, re-measure it and update the row with its date.

## Setup

Unless a row says otherwise, numbers come from the remote QA sandbox: a virtual Apple M4 Pro with 6 cores and 20 GB of memory, macOS 26.6, running a debug build of Manor Staging (`build-app.sh staging --debug`) signed in to the staging showroom account. Release builds on a physical Mac are faster, so treat these as upper bounds.

Launching with `MANOR_PERF_LOG=<file>` appends one line per milestone: the label, milliseconds since the process started or since a page switch began, and the process's physical footprint, the number Activity Monitor shows as Memory.

## Launch

| Milestone | Time | Footprint | Measured |
| --- | --- | --- | --- |
| First window, first launch after a rebuild | 708 to 714 ms | 21 to 22 MB | 2026-11-18 |
| Signed-in window, first launch after a rebuild | 763 to 771 ms | 30 MB | 2026-11-18 |
| Signed-in window, warm launch | about 200 ms | about 30 MB | 2026-11-18 |

A first launch after a rebuild includes the system's signature and library-cache checks for the new binary; a warm launch is the everyday case.

For comparison, the retired desktop shell reached its first window in about 300 ms on the owner's Mac.

## Page switches

| Switch | Time | Measured |
| --- | --- | --- |
| Revisiting a page (kept alive while hidden) | about 30 ms, 31 to 41 ms by page | 2026-11-18 |
| Revisiting a page before the sidebar left page layout | about 80 ms | 2026-11-18 |
| First visit to Notes, before prewarming | 200 to 290 ms | 2026-11-18 |
| First visit to Notes, after prewarming | 31 ms | 2026-11-18 |
| First visit to Problems, after prewarming | 85 ms | 2026-11-18 |
| Revisiting Problems | 36 to 40 ms | 2026-11-18 |

Two changes produced the drops. The docked sidebar is an overlay beside the pages instead of a layout sibling, so a selection change no longer re-lays out every kept-alive page. About 1.5 seconds after the signed-in window appears, once input has paused for 0.4 seconds, Notes and Problems are built offscreen one at a time; that took 75 to 80 ms for Notes and 32 to 53 ms for Problems. A first visit to Problems still renders its table rows, which a hidden page skips, so it stays about 45 ms above a revisit.

The retired desktop shell switched routes in 180 to 750 ms before its local mirror and 10 to 30 ms after it.

## Memory

| State | Footprint | Measured |
| --- | --- | --- |
| Signed-in window | 30 MB | 2026-11-18 |
| After prewarming Notes and Problems | 47 to 49 MB | 2026-11-18 |
| After showing Home, Notes, and Problems | 104 to 105 MB | 2026-11-18 |
| After visiting every page | about 145 MB, about 50 MB of it the Problems library | 2026-11-18 |
| After 60 hover cards, 30 signature help cycles, 8 rounds of every page, and Notes typing and selection | 156 MB, peak 160 MB, 14 KB leaked | 2026-11-18 |

## Alfred answers

`AlfredBenchmarkTests` sends twelve interview, coding, system design, behavioral, and screen cases with Alfred's real instructions to a live provider, from this Mac's network. Times are from sending the request; "first text" is the first visible answer text, after any thinking.

| Model | Setting | First text, median | Full answer, median | Slowest | Thinking per answer | Measured |
|---|---|---|---|---|---|---|
| Claude Opus 5.5, fast mode | Low effort | 1.2 s | 5.3 s | 7.9 s | about 160 tokens | 2026-11-19 |
| Claude Opus 5.5, fast mode | Medium effort | 2.6 s | 7.8 s | 11.3 s | about 560 tokens | 2026-11-19 |

Full coding answers run 1,400 to 2,500 output tokens with a step-through diagram and commented code. At low effort the generated Python passed every randomized check: 300 graph reachability cases, the rotten oranges examples, 215 top-k cases, and 200 LRU operation sequences. A one-line "answer directly" nudge saved about 0.2 seconds and was not kept. GPT-6.1 Terra on OpenAI's fast tier, the default, answers in about 2 to 3 seconds; it was not re-measured alongside.

## Upload recovery

A 381 MB file block was force-quit mid-upload and Manor relaunched. The upload journal and the block's link survived, and the reopened note resumed the transfer and filled in the block in under a minute, clearing both. The [files and uploads](files-and-uploads.md#note-attachments) slice describes the mechanism.

## Contrast

Measured from screenshots against the surface behind the text, as the WCAG contrast ratio; body text needs 4.5:1.

| Text | Light | Dark | Measured |
| --- | --- | --- | --- |
| Alfred diagram faint text (array indices), before the fix | not measured | 3.1:1 | 2026-11-18 |
| Alfred diagram faint text, after the fix | 5.05:1 | 7.55:1 | 2026-11-18 |
| Alfred diagram muted text (row labels) | 5.44:1 | 6.37:1 | 2026-11-18 |

The muted-text figures predate a small increase in its opacity, so they are lower bounds.
