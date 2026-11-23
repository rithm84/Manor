# Manor product decisions

_Last updated: 2026-11-22_

This page is the dated record of Manor's product decisions. The [PRD](PRD.md) states the behavior those decisions produce today, and the [architecture](ARCHITECTURE.md) records the technical design. When a decision changes behavior, the PRD changes in the same edit, so the two pages always agree.

Each entry names the decision and, in parentheses, the PRD sections it shapes. An entry that a later decision replaced is marked **Superseded** with a pointer to its replacement; its old wording is dropped rather than kept as a second rule.

## Foundations

| Date | Decision |
|---|---|
| 2026-08-19 | Manor's product and core tracker mechanics are selected ([product thesis](PRD.md#product-thesis), [positioning](PRD.md#positioning), [principles](PRD.md#product-principles), [streak system](PRD.md#streak-system)). |
| 2026-08-22 | One merged task workspace, attempt-based problem history, rich Notes, and centered object details ([modules](PRD.md#modules), [surfaces](PRD.md#surfaces)). |
| 2026-08-23 | The standalone calendar workspace is removed; connected calendar events appear only on Home's Today timeline ([Home and tasks](PRD.md#home-and-tasks)). |
| 2026-08-26 | Freezes are spent by hand, retirement is non-destructive, and a jobs listing joins the pipeline only when you add it ([streak system](PRD.md#streak-system), [Jobs](PRD.md#jobs)). |
| 2026-08-27 | Every month opens with a full freeze pool ([streak system](PRD.md#streak-system)). |
| 2026-08-29 | Editable contexts, the problem mistakes log, and note finding and lifecycle refinements ([modules](PRD.md#modules)). |

## Platform, accounts, and agents

| Date | Decision |
|---|---|
| 2026-09-09 | Codex is the interactive agent and operates Manor through its tools; requested operations run directly without an approval screen ([agents](PRD.md#agents-and-background-work)). |
| 2026-09-09 | Gated signup (Google sign-in superseded by 2026-11-19 Sign in with Apple), a saved account time zone, seven-day Trash that includes Notes, recurrence occurrences, and private tool-accessible history whose structure survives content purge ([platform and data policies](PRD.md#platform-and-data-policies), [action history](PRD.md#action-history)). |
| 2026-09-09 | Explicit sign-out cancels while drafts are unsynced; daily database and file backups with seven-day retention ([reliable data](PRD.md#reliable-data-and-offline-work), [recovery and retention](PRD.md#recovery-and-retention)). |
| 2026-09-09 | Remote MCP, scheduled ChatGPT weekly reviews, persistent optional Notes suggestions, document tabs, seven-day Notes versions, and recurrence edit scope ([agents](PRD.md#agents-and-background-work), [Notes](PRD.md#notes)). |
| 2026-09-11 | Google Calendar syncs every minute, with at most twelve calendars across all connected Google accounts ([integration boundary](PRD.md#integration-boundary)). |
| 2026-09-12 | Journal is removed entirely: no encrypted writing surface, schema, or tooling ([scope](PRD.md#scope)). |
| 2026-09-13 | Remote MCP is the only agent transport, with no live-window context or presentation tools ([agents](PRD.md#agents-and-background-work)). |
| 2026-09-13 | Manor is a Mac app with separate staging and production identities, sign-in and agent consent that return to the app through its link scheme, and signed automatic updates from GitHub Releases; the website is retired ([platform](PRD.md#platform)). |
| 2026-09-13 | A Canvas course calendar feed link is saved in Settings and read live by an agent tool; nothing is imported and no tasks are created automatically ([integration boundary](PRD.md#integration-boundary)). |
| 2026-09-14 | Every module reads from a copy of the account kept on the Mac and updated from the backend's change feed; saves stay server-authoritative ([reliable data](PRD.md#reliable-data-and-offline-work)). |
| 2026-11-17 | Manor is a native SwiftUI and AppKit app; the backend, data, and agent tools carry over unchanged ([platform](PRD.md#platform)). |
| 2026-11-17 | Alfred, Manor's personal assistant, runs inside Manor as a notch overlay and menu bar item with General and Prep modes, Control-Option shortcuts, and Manor-owned Screen Recording and Microphone permissions requested on first use. This supersedes the earlier rules of no embedded assistant, no summon UI, no desktop hotkey, and no permission onboarding; Codex stays the agent that operates your Manor data ([Alfred](PRD.md#alfred), [platform](PRD.md#platform)). |
| 2026-11-18 | Alfred captures the window you are working in rather than the whole display, and reads its text through Accessibility when you allow it, so answers are more exact without capturing the notch panel or other windows ([Alfred](PRD.md#alfred)). |
| 2026-11-18 | Prep-mode coding answers name the other standard approaches when a problem has several, showing one in the diagram and code ([Alfred](PRD.md#alfred)). |
| 2026-11-18 | Prep-mode coding answers end with a short edge-case list, each case paired with where the code handles it ([Alfred](PRD.md#alfred)). |
| 2026-11-18 | Prep-mode code is commented generously, so the comments alone explain it: numbered step comments say what each step does and why, and short trailing comments sit on most meaningful lines ([Alfred](PRD.md#alfred)). |
| 2026-11-18 | When an interviewer's new problem leaves open something that changes the solution, Prep mode shows the clarifying questions to ask before the answer, so you practice asking them; fully specified problems, typed requests, and quick actions are answered directly ([Alfred](PRD.md#alfred)). |
| 2026-11-19 | Tracking History drops the month calendar of days, since Log a past day opens any earlier day; the month's mood and focus beside the habits shows each signal's most common level, a split bar, and per-level shares. Pomodoro History is a centered page with a redesigned session log ([Tracking](PRD.md#tracking), [Pomodoro](PRD.md#pomodoro)). |
| 2026-11-19 | Alfred reasons only with Claude Opus 5.5 in fast mode at low effort: answers, conversation memory, Notes writing, and Alfred in Manor. GPT-6.1 Terra and the other answer providers are removed; OpenAI's GPT-6 Luna stays only for the new-topic check. Interview answers avoid em dashes, end coding answers with complexity and then edge cases, and don't ask about details a well-known problem's standard statement settles ([Alfred](PRD.md#alfred)). |
| 2026-11-19 | Manor is signed with a Developer ID certificate and notarized by Apple, replacing the self-signed certificate; updates require the same developer team, and builds signed before the switch need one manual install ([platform](PRD.md#platform)). |
| 2026-11-19 | Sign in with Apple replaces Google as the only sign-in. A new Apple ID is asked for the invitation password after Apple signs it in, so Hide My Email works, and existing accounts keep their data by linking an Apple ID ([accounts and dates](PRD.md#accounts-and-dates)). |
| 2026-11-19 | Alfred's provider keys move to Manor's backend: a signed-in account uses Alfred with no keys of its own, through a proxy that enforces per-account daily and monthly allowances and counts usage without storing content. This supersedes keeping your own keys in the Keychain ([Alfred](PRD.md#alfred)). |
| 2026-11-21 | Alfred's live listening mode is named Prep mode ([Alfred](PRD.md#alfred)). |
| 2026-11-22 | The notch opens Alfred on hover by default and folds it away when the pointer leaves; clicking the notch opens it ready to type and closes it again. A setting switches the notch to click only ([Alfred](PRD.md#alfred)). |
| 2026-11-22 | Manor's MCP address is published in the README and shown in Settings ▸ Connections with copy buttons; agents still sign in and need your approval ([platform](PRD.md#platform)). |
| 2026-11-17 | In Prep mode, quitting Manor from the Dock or with Command-Q hides Manor and leaves Alfred in the menu bar ([Alfred](PRD.md#alfred)). |
| 2026-11-18 | `/alfred` in Notes opens a composer dialog with images; the result lands in an Alfred block rendered with the note's own block views, and selected text or blocks can be rewritten through a preview that changes nothing until applied ([writing in Notes](PRD.md#writing-in-notes)). |
| 2026-11-18 | With Manor in front, Alfred's shortcut opens Alfred inside Manor, where it acts on your records when you ask, through the same commands the pages use; each action offers Undo and irreversible ones ask first. Codex remains the agent for everything outside the app ([Alfred in Manor](PRD.md#alfred-in-manor), [scope](PRD.md#scope)). |

## Modules

| Date | Decision |
|---|---|
| 2026-09-10 | The last unused context can be removed; contexts referenced by tasks stay protected ([Home and tasks](PRD.md#home-and-tasks)). |
| 2026-09-10 | Mood and focus history accepts ratings for any past day; quick capture keeps its today-and-yesterday window ([Tracking](PRD.md#tracking)). |
| 2026-09-13 | Permanent deletion from Trash is yours alone and purges at once; the note list is multi-select; concurrent note edits merge by block, and only same-block conflicts ask you to compare versions ([Notes](PRD.md#notes), [recovery and retention](PRD.md#recovery-and-retention)). |
| 2026-09-14 | Pomodoro: one active session at a time, editable timer preferences, month statistics with an informational day streak, and agent tools for sessions ([Pomodoro](PRD.md#pomodoro)). |
| 2026-09-15 | Page and create shortcuts with a Settings reference, remembered module views, habit tile ordering and sorting, keyboard month navigation, and Undo for habit archiving and pausing ([surfaces](PRD.md#surfaces), [Tracking](PRD.md#tracking)). |
| 2026-09-23 | Importing Markdown with its images and files is agent work through `import_markdown_note`; the in-app import takes text only, and an opening heading titles the note ([Notes](PRD.md#notes)). |
| 2026-09-23 | Notes has two panes: the note list, whose header picker holds the views and folders, and the editor ([Notes](PRD.md#notes)). |
| 2026-10-04 | Task deadlines take an optional time in the saved time zone and become overdue at that minute ([Home and tasks](PRD.md#home-and-tasks)). |
| 2026-10-11 | Problems becomes a general problem library with saved views, company and topic filters, source recency, reversible duplicate groups, six-language solving, versioned testsets, and durable code drafts; practice streaks and freezes are removed ([Problems](PRD.md#problems)). |
| 2026-10-12 | Stock problems become fully solvable in Manor with original restatements, LeetCode-style signatures, and saved testsets; accepted submissions log attempts automatically; grading keeps the original answer semantics ([Problems](PRD.md#problems)). |
| 2026-10-13 | Stock content is checked against the original public problem; solutions end with a validated Python reference; topics use two levels, categories over patterns ([Problems](PRD.md#problems)). |
| 2026-10-13 | The problem library is a shared, read-only Manor catalog; custom problems stay private and are edited only through Codex; practice state stays per account ([Problems](PRD.md#problems)). |
| 2026-10-14 | A role in the OA stage records when its online assessment was completed ([Jobs](PRD.md#jobs)). |
| 2026-10-24 | A failed submission reveals its first failing case; other hidden cases and checker code stay private ([Problems](PRD.md#problems)). |
| 2026-10-24 | Module navigation keeps each visited page, its open workspace, controls, and scroll for the signed-in session ([surfaces](PRD.md#surfaces)). |
| 2026-11-17 | Habits and Mood and Focus merge into one Tracking page with Daily and History tabs ([Tracking](PRD.md#tracking)). |
| 2026-11-17 | The Weekly reviews page is removed; reviews stay readable through agent tools ([weekly review](PRD.md#weekly-review)). |
| 2026-11-17 | The AI-written daily synthesis and debriefs are removed; Tracking logs ratings only ([Tracking](PRD.md#tracking)). |
| 2026-11-17 | Jobs has two views, Pipeline with the Flow chart and Listings, whose filters include whether a listing is already in your pipeline ([Jobs](PRD.md#jobs)). |
| 2026-11-17 | The Master task view groups by context by default ([Home and tasks](PRD.md#home-and-tasks)). |

## Design

| Date | Decision |
|---|---|
| 2026-09-09 | The paper-and-ink identity is retired in favor of a smooth sans-serif product aesthetic with rich Notes editing and deliberately designed light and dark modes ([design](PRD.md#design)). |
| 2026-09-13 | The theme preference adds day and night: light from 6 AM to 6 PM local time, dark otherwise ([design](PRD.md#design)). |
| 2026-11-17 | The native charter: SF Pro for interface and body text, Outfit for titles, the plum and gray palette with contrast-checked roles, and Liquid Glass for floating chrome on macOS 26 with solid surfaces elsewhere ([design](PRD.md#design)). |

## Superseded

| Date | Decision | Superseded by |
|---|---|---|
| 2026-09-09 | Full web migration with a React frontend and a website. | 2026-09-13 Mac app, then 2026-11-17 native app. |
| 2026-09-13 | The Mac app is a webview shell around the React frontend. | 2026-11-17 native app. |
| 2026-09-09 | Manor embeds no conversational assistant, summon UI, desktop hotkey, or permission onboarding. | 2026-11-17 Alfred. |
| 2026-09-09 | An AI-written daily synthesis per day, updated from debriefs. | 2026-11-17 removal of the daily synthesis. |
| 2026-11-17 | `/alfred <request>` in Notes writes an Alfred block in place, refined by asking Alfred again. | 2026-11-18 composer and selection editing. |
