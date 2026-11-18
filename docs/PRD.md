# Manor PRD

_Last updated: 2026-11-18_

This page defines what Manor does: its scope, behavior, business rules, and vocabulary. It states the current product only. The dated history of how each rule was decided is in [product decisions](DECISIONS.md), the technical design is in the [architecture](ARCHITECTURE.md), and the visual direction is in the [design charter](DESIGN.md).

## Product thesis

Manor is a personal productivity app for the Mac. It covers tasks and the day's schedule, habits, mood and focus, a focus timer, coding interview practice, job applications, notes, and a knowledge base, and it carries a personal assistant, Alfred, in the menu bar and the notch.

Manor brings your tasks, habits, notes, and other records together in one place that is easy to keep current. Logging takes a click, nothing needs manual syncing or filter rotation, and every record an agent touches is the same record you see. Even with one primary user, Manor meets a product bar: account isolation, sign-in, onboarding, settings, designed empty states, and durable data.

## Positioning

Manor provides the productivity interface and the domain rules. Agents provide general reasoning and connected knowledge: Codex, or any other agent host you connect, reads and acts on your Manor data through Manor's MCP tools, under the same rules as the interface. You can work directly in Manor, ask an agent to operate it, or both.

Alfred is different from those agents. It is Manor's own assistant for the moment you're in: it answers questions about what is on your screen or, in Prep mode, about a live conversation. It doesn't operate your Manor records.

Manor is not a team workspace or a calendar app. Collaboration and shared workspaces are out of scope. Each account owns its data; the jobs listings and the problem catalog are shared Manor content, and your practice on them is your own.

## Vocabulary

| Term | Meaning |
|---|---|
| **Module** | A page-level feature unit: Home, Tracking, Pomodoro, Problems, Jobs, Notes, and Bookmarks. Simple trackers such as mood and focus are defined by configuration; complex modules are defined in code. |
| **Codex** | The agent you use to operate Manor through its MCP tools. Other OAuth-capable agent hosts work the same way. |
| **MCP tools** | Manor's agent operations, served by its remote MCP endpoint. |
| **Alfred** | Manor's personal assistant, in the notch and the menu bar. |
| **General mode** and **Prep mode** | Alfred's two modes: answers about your screen or any question, and an interview preparation assistant that listens to practice conversations. |
| **Weekly review** | The scheduled summary of a week of habits, mood, focus, and tasks, written by a hosted agent task. |
| **Perfect day**, **freeze pool**, **Earn-Back** | The streak mechanics in the [streak system](#streak-system). |
| **Scratch blocks** | Disposable, Manor-only time blocks on Home's timeline. |

## Product principles

1. **Frictionless logging.** Direct actions and agent requests complete in minimal steps.
2. **Little maintenance.** Nothing needs manual syncing, filter rotation, or bookkeeping to stay usable.
3. **Habit streaks are core behavior.** The [streak system](#streak-system) applies to habits. Problem practice has no streak or freeze system.
4. **Useful reflection.** Weekly reviews make accumulated data useful without unsolicited changes to your work.
5. **Consistency by design.** Habit logging and quick mood and focus capture accept today and yesterday. Mood and focus history and problem attempts accept any past date, never a future date.
6. **Expressive, efficient design.** Celebration and urgency are restrained, and content uses space well, following the design charter.
7. **Fast, truthful state.** Tool results and the visible UI agree with committed data. Unsaved work, conflicts, and failures stay visible.

## Platform and data policies

### Platform

Manor is a native macOS app built with SwiftUI and AppKit for macOS 15 and later. It installs from a signed build and updates itself from Manor's releases. On macOS 26 it draws Liquid Glass for floating chrome and uses solid surfaces on earlier systems. There is no website and no web view shell.

- **Signing in** opens Google in a system sign-in window that returns the result to the app.
- **Connecting an agent** opens Manor through a link it registered with macOS, and you approve the request inside the app.
- **Links** that leave the app open in your browser, and a Manor link opens the app on the page it names.
- **Closing the window** keeps Manor running, so it reopens instantly from the Dock; Quit ends it, except in Alfred's Prep mode (see [Alfred](#alfred)).
- **Agents** operate Manor through remote MCP, which needs no open Manor window.
- **Alfred** gives Manor a notch overlay, a menu bar item, and Control-Option shortcuts that work in any app; with Manor in front, the same shortcut opens Alfred inside Manor (see [Alfred](#alfred)). The rest of Manor uses ordinary in-app shortcuts.
- **Permissions** belong to Manor: it asks for Screen and System Audio Recording and Microphone access only when Alfred first needs them, with no separate onboarding. Manor sends no desktop notifications.

Production and staging are separate apps, `Manor` and `Manor Staging`, that can be installed side by side; a link for one never opens the other.

### Reliable data and offline work

UI actions and agent actions obey the same business rules. Results reflect persisted outcomes, without duplicate changes on retry or silent overwriting of concurrent edits. Relevant views update promptly, and unsaved work and failures stay visible.

Every module reads from a copy of your account kept on the Mac, so its pages open at once and stay readable without a connection; that copy also holds the shared problem catalog. Saving still needs a connection. Notes protects drafts and pending attachments on the Mac through connection loss and relaunches, and the coding workspace protects source drafts on the Mac before saving them to your account. The interface distinguishes protection on the Mac from saving to the cloud.

**Explicit sign-out cancels automatically while unsynced Notes, code drafts, or uploads remain**, keeping the session and drafts intact with a clear explanation. There is no download, discard, or forced sign-out in that flow. Ordinary session expiry keeps drafts for the same account to recover after signing in again.

### Accounts and dates

Account creation and sign-in use Google only. Manor has no password of its own, email-and-password signup, password reset, or verification email. A new user also passes the shared signup-password gate before the account is created; returning users sign in with Google without repeating it. Display names are independent of authentication, and account data stays private to its owner. Connecting Google Calendar is a separate, optional consent.

Each account saves a time zone, initially taken from the system, and travel doesn't silently change it. That time zone governs today and yesterday, streak boundaries, recurrence, and weekly reviews. Changing it doesn't relabel existing daily history, and calendar events keep their intended instants.

### Recovery and retention

Tasks, job applications, and notes share a recoverable Trash for seven days, then purge automatically. Deleting a note includes its subpages, and restoring it preserves their relationships. Notes in Trash can also be deleted permanently at once, one or many, after a confirmation. Permanent deletion is yours alone: agents can move records to Trash and restore them, never purge them. Archiving is distinct from Trash, and retiring a habit archives it under the streak system.

Attached files follow their parent's lifecycle, but purging one record never deletes a file still used elsewhere. After purge, ordinary application data and tools can't recover the deleted content through history, old versions, search, or derived outputs; structural behavioral history can remain (see [action history](#action-history)). Stale clients can't resurrect deleted records.

Disaster recovery uses daily database and file backups with seven-day retention, so up to a day of recent changes can be lost after a failure. Restricted backups can retain subsequently deleted content until they expire; they are not a user-visible archive.

### Existing data

Existing records and files were preserved when they were migrated into Manor. Legacy Journal data was discarded with the removed Journal feature, and the daily synthesis text was removed with that feature (see [scope](#scope)).

## Agents and background work

### Authority and tool coverage

Explicitly requested reads, creates, edits, archiving, deletion, and restoration execute directly, subject to domain rules and account authorization. Manor adds no blanket confirmation or approval screen. An agent acts when you invoke it and doesn't rewrite notes on its own. Real ambiguity or conflicting edits can require clarification, and host-level permissions are outside Manor's control.

Tools offer comprehensive reads, search, filters, summaries, aggregates, precise edits, useful bulk actions, lifecycle operations, and meaningful action history across modules. Depth and speed are requirements: meaningful operations complete in bounded batches with few intermediate calls when intent and targets are clear, and an agent never has to open a page before acting. There is no unrestricted database access. The tool catalog is in the architecture's [agents and MCP tools](arch-components/agents-and-mcp-tools.md) slice.

Authorized note edits apply directly, preserving unsaved text and surfacing genuine conflicts. When you ask for suggestions, proposed edits persist in Notes until you accept or reject them, individually or together. Suggestion review is optional, not a gate for ordinary requested edits.

### Integration boundary

Agents read Gmail, Slack, calendars, and other sources through their own integrations and call ordinary Manor tools to update tasks or other records. Manor's tools are source-independent; optional provenance can reference the source that motivated a change.

Manor itself keeps four integrations current, independently of any agent conversation:

- **Google Calendar** is read-only, with multiple accounts and per-calendar visibility. At most twelve calendars in total across connected accounts are allowed, hidden ones included; a connection that would exceed the limit is rejected, and a calendar that later appears beyond the limit isn't added while the others keep syncing. Connected calendars sync every minute. Scratch blocks never write back.
- **X bookmarks** are ingested periodically into the [knowledge base](#bookmarks).
- **The jobs catalog** is ingested from SimplifyJobs (see [Jobs](#jobs)).
- **A course calendar feed** link from Canvas, saved under Connections in Settings, gives agents a live read of upcoming assignments, quizzes, and exams. Nothing from the feed is imported or stored, and turning what's due into tasks is an ordinary task request.

### Weekly review

A scheduled ChatGPT task writes the weekly review and saves it in Manor through remote MCP, where agents read it back. It runs every Sunday at 10 PM in your saved time zone and covers the week up to then: habits, mood, focus, and task completion, from stored records and meaningful history. Reviews summarize and suggest; they don't change tasks or notes. The run doesn't depend on your Mac or an open Manor window. Manor has no weekly review page.

### Action history

Manor keeps an account-scoped, durable history of meaningful state changes by you, agents, and background work, exposed through agent tools; there is no history page. It records field changes and useful provenance, not navigation, clicks, keystrokes, reads, or no-op writes. History survives sign-out and is kept until explicitly cleared, subject to content scrubbing on purge.

After an object is purged, only structural information useful for behavior analysis remains, such as that an unidentified task was postponed or an application changed stage. Identifying titles, document contents, old text values, and source excerpts are removed.

### Notifications

Manor sends no proactive notifications. Due and at-risk states stay visible inside Manor. Notifications are deferred to a future iOS companion.

## Alfred

Alfred is Manor's personal assistant. It lives inside Manor's process as an overlay that sits flush with the Mac's notch and as an item in the menu bar, so it is a keystroke away from whatever you're doing. Press Control-Option-Space and a black, hardware-style card springs from the notch and streams the answer; on a Mac without a notch, the card drops from the top center of the screen. The mode you choose is saved on the Mac.

### Modes

- **General mode** is the default. Alfred answers any question you type, or anything about what's on your screen: it captures the window you're working in (the topmost window that isn't Manor's), so its own panel, other apps, and the desktop stay out, and reads that window's text when you allow Accessibility, without selecting or changing anything in it. Password fields are never read. With no other window open it captures the display under your pointer instead. General mode never listens to audio. Its quick actions are Answer, Explain, Summarize, and Visualize, over your screen and the chat.
- **Prep mode** helps you prepare for technical conversations, with a focus on data structures and algorithms. Alfred listens to the other side of the call through system audio and to you through the microphone, keeps a running transcript, tracks the open question, and often prepares an answer as soon as a practice question ends. Its answer styles are interview, coding, system design, and meeting, with a preferred coding language. Its quick actions are Answer, Diagram, Follow-ups, and Recap.

Answers see the conversation, your screen when you allow it, the chat so far, and your knowledge documents. A typed question always takes priority. Alfred keeps up to five chat tabs, each remembering its recent exchanges, and opens a new tab when the conversation moves to a different problem.

### What answers contain

Answers are Markdown with code, plus two visual forms Alfred draws natively as they stream:

- **Data-structure diagrams**: arrays, strings, lists, stacks, queues, trees, heaps, tries, grids, maps, intervals, graphs, and flowcharts, with pointers, highlights, and step-throughs you move through frame by frame.
- **Generative UI**: charts, tables, metric tiles, key-value lists, comparisons, steps, tabs, callouts, and code, written in Alfred's own compact UI language.

### Your keys and your data

Alfred calls model providers with your own keys: OpenAI for answers, conversation memory, topic routing, Notes writing, and Alfred in Manor, and Deepgram for live transcription. You enter them in Settings, where each is checked with its provider; they are stored in the Mac's Keychain and sent only to that provider. Alfred doesn't route through Manor's backend. It reads and changes your Manor records only when you ask it to inside Manor (see [Alfred in Manor](#alfred-in-manor)).

Knowledge documents (your résumé, experience, job descriptions, and notes) stay on your Mac. You choose which ones Alfred uses. Finished sessions are saved as Markdown files on your Mac when session saving is on.

### Always at hand

Every Alfred shortcut uses Control and Option, so none collide with editors or coding pads. Settings lists them and marks any that another app already holds. The menu bar item shows the mode, a dot while listening, and controls to answer, listen, mute, start a new session, change mode, open Settings, open Manor, and quit.

In Prep mode, quitting Manor from the Dock or with Command-Q hides Manor's windows and Dock icon instead of ending the process, so Alfred keeps listening from the menu bar. **Quit Manor** in Alfred's menu ends it. Logging out, restarting, shutting down, and installing an update always quit.

### Alfred in Manor

When Manor's window is in front, Control-Option-H (and Control-Option-Space in General mode) opens Alfred as a centered dialog inside Manor instead of the notch card; **Ask Alfred** in the View menu does the same. Alfred sees a compact summary of the page you're on, such as today's tasks, habits, the timer, roles, or the open note's outline, and answers questions about it or changes things when you ask: complete, reopen, reschedule, and prioritize tasks, create tasks and notes, log habits and daily ratings, start, pause, resume, and stop Pomodoro sessions, move roles between stages, mark online assessments done, add to the open note, and open pages.

- **Every change is visible and reversible.** Each action shows as its own row in the conversation with an **Undo** button. An action that can't be undone, such as ending a Pomodoro session, asks first and runs only when you approve.
- **No guessing.** When a request could mean several records, or none, Alfred asks instead of picking one.
- **Same rules as the pages.** Alfred's changes go through the same commands the pages use, so they sync, appear in history, and follow every module's rules.
- **Conversation.** Alfred remembers the conversation until you start a new chat or sign out. Closing the dialog leaves it as it was.

### Writing in Notes

Typing `/alfred` in a block and pressing Return opens the **Alfred composer**: a centered dialog that names the note it writes into, takes a multi-line request (Return sends, Shift-Return adds a line, Escape closes), and accepts images by drag and drop, paste, or the add button, shown as removable thumbnails and downscaled before sending.

- **An Alfred block** holds everything generated for the request where `/alfred` was typed: prose, data-structure diagrams, and generative UI. It renders with the note's own block views, so its headings, lists, tables, code, quotes, callouts, toggles, and math look and behave like the rest of the note, in light and dark. While Alfred thinks, the block shows a restrained working state that honors Reduce Motion; then the content streams in and grows in place.
- **Refining.** The block shows **Ask Alfred to change…** when you point at or select it, which opens the composer titled for the change with the block's earlier requests. Alfred rewrites the block in place. The block menu adds **Try again**, **Copy**, **Delete**, and **Turn into regular blocks**, which unwraps the prose into ordinary blocks and keeps each diagram and generative UI element as its own block for hand-editing.
- **Editing a selection.** Select text in a block or select whole blocks, then press Command-J, choose **Ask Alfred** in the formatting toolbar, or choose it in the block menu. The composer offers one-click requests: Improve writing, Shorter, Longer, Fix spelling and grammar, Simplify, Make a list, Make a table, and Visualize as a diagram. The result streams into a preview under the selection, which stays highlighted; nothing in the note changes until you choose **Replace selection** (Return) or **Insert below**. **Try again**, **Ask for changes…**, and **Discard** (Escape) work on the preview. Replacements come back as the note's own blocks, or as inline text that keeps the surrounding text and styles for a selection inside one block.
- **Control.** Escape stops a running generation, and a whole insertion, rewrite, or replacement undoes as one step. A missing key or network failure shows inline with a retry, never in a separate alert.
- **Context.** Alfred sees the note's title, nearby text, the request and its images, the selection when editing one, and, when refining, the block's current content and requests. It never sees your screen or audio from Notes.
- **Storage.** The block keeps Alfred's full output, the requests in order with their images saved as note attachments, and the model that wrote it, so it survives sync, version history, and agent tools unchanged. Markdown export writes the latest request as a quote followed by the content, Markdown import turns diagram and UI fences back into visual blocks, and search indexes the block's text.

## Streak system

The mechanics derive from Duolingo's, adapted. The following diagram shows how one habit's day resolves.

![How one habit's day resolves: checked off at 100 percent continues the streak; a missed day can be backfilled or covered by a freeze the next day; otherwise the streak breaks, and two clean days within 48 hours restore it once a month through Earn-Back, or it starts over at zero.](diagrams/svg/prd-streak-day.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](diagrams/svg/_key.svg)

</details>
<p></p>

- **Per-habit streaks.** There is no single global streak.
- **Perfect day.** Every *active* habit is complete; paused habits don't count. Perfect days earn spent freezes back.
- **Freeze pool.** A shared monthly pool sized to the number of habits in play: a new habit adds one, retiring removes one, and the count resets from the active roster each month. Every month opens with a full pool, and perfect days earn spent freezes back up to capacity. Freezes are spent by hand, never automatically, and a freeze covers one habit on one day. The next day you either backfill the missed check-off or spend a freeze on it. Any number of habits can be covered on one day while the pool lasts. Breaking a day forfeits the grant that day would have earned, so covering two misses on one day needs a freeze banked earlier. Freezes reach as far back as habit backfill: yesterday only. Spending a freeze and then backfilling the real check-off refunds it automatically.
- **Earn-Back.** When a streak breaks with an empty pool, two clean days within 48 hours restore it, once per habit per month. It is the only recovery path.
- **Gold state.** Seven freeze-free days per habit, shown by design (a gilded flame and number), never by a text chip.
- **Habit shape.** Binary, or quantized with a step ladder derived from the target label; there are no free-form amounts. A target reading "N units" with N up to 8 logs one step per unit ("3 tablets" cycles 0, 33, 66, 100); larger or unitless targets log in quarters. Entries store integer percents from 1 to 100, and only 100 counts as complete. Habits can be added, paused, or retired any time; a habit added mid-month starts at streak 0 and counts toward perfect day at once. Retiring archives the habit and keeps every entry, streak, and spent freeze; a retired habit can be reactivated, the gap days count as misses, and the old streak doesn't resume. There is no permanent habit deletion.
- **Backfill.** One day for habits and quick mood and focus capture, with same-day edits allowed. Mood and focus history permits older corrections and missing-day logging. Problem attempts backfill freely into the past.
- **Urgency.** At-risk emphasis lives on the habit rows; there is no proactive delivery (see [notifications](#notifications)).

## Modules

### Home and tasks

Home is the task board beside the Today timeline.

- **One task system** covers academic and personal work with contexts. A context carries a chosen icon and semantic color everywhere it appears. Task fields: status, due date with an optional minute-precision time in your saved time zone, context, difficulty as a time estimate, priority, and recurrence with full rule granularity (specific weekdays, intervals, end dates).
- **Computed due buckets.** Overdue, Today, Tomorrow, and This Week are computed, never hand-maintained. A timed task becomes overdue at its deadline; a date-only task becomes overdue the following day.
- **Weekly view** is the due-bucket board, ordered by exact due date and time, then High, Medium, and Low priority, with date-only deadlines after timed ones on the same day. Today and Tomorrow cards show only an optional due time as their first tag; This Week and Overdue cards show the due date and optional time first. Overdue has no create path; Today and Tomorrow create on their exact date; This Week requires an exact date within the board's remaining seven days. Dragging into Today or Tomorrow moves the due date to that day; dropping onto This Week opens the due-date editor, because a range is not a date.
- **Master view** is the longer-horizon task table. It groups by context by default, with grouping off as an option, and has title search, a fixed due-first order, an additive property-filter builder for context, status, priority, and due date, and a Completed toggle; the working view excludes completed tasks. Applied filters clear in one action, and filter sets can be saved as named views. The Due column shows date and time.
- **Task details** open as a centered dialog on a single click. Edits form a local draft with **Save changes**; closing commits the draft, and a failed save keeps it. Completion stays on the card checkbox. A new task's context starts unset and has to be chosen or created, and the first save creates the selected recurrence schedule. Completing or deleting a task offers Undo.
- **Recurrence.** Each scheduled occurrence is tracked independently. A missed occurrence stays overdue until completed or explicitly skipped, and completing one occurrence doesn't erase missed ones. Editing recurrence applies to this occurrence or this and future occurrences; completed, skipped, and historical occurrences keep their outcomes.
- **Contexts.** Names, icons, and colors are editable. Renames preserve task and saved-view references, and duplicate names are rejected. A context can't be removed while any task references it, including tasks in Trash; the last context can be removed when unused.
- **Today timeline.** Events from connected calendars and scratch blocks share a single-column timeline from 6 AM through midnight with a now-line. Manor has no calendar workspace.
- **Scratch blocks** are Manor-only time blocks never written to Google. Dragging a task onto the Today or Tomorrow schedule creates one, as does dragging on empty timeline. Blocks snap to 15 minutes; the task's estimate supplies the initial duration (one hour when unset), and date, start, duration, and the portion label are editable. A block can stand alone or time-block a task without changing the task, and it deletes itself 48 hours after its scheduled end.

### Tracking

Tracking is the daily home for habits, mood, and focus. It has two tabs.

**Daily** logs the day: the mood and focus check-in, the habit list with week strips, current and best streaks, and the freeze pool as a first-class object. Habits are added, paused, and retired here, and an Archived section reactivates retired habits. On the Yesterday view, a missed habit row offers a Freeze control that toggles back off, and the pool balance moves with it. Archiving or pausing a habit offers Undo for a few seconds.

**History** covers all three signals on one page:

- **Habits:** 3, 6, and 12-month completion trends across all habits or one selected habit, and a month breakdown that gives each habit a completion ring with its day counts. Tiles follow your habit order (draggable, as on the daily list), completion rate, or name, and a toggle shows or hides retired habits. Completion rates count eligible tracked days only: periods before creation, paused or retired periods, and future dates aren't misses.
- **Mood and focus:** a month summary naming the average mood and focus in scale words, a 3, 6, or 12-month trend of monthly averages with rest days excluded from focus, a month calendar where each day names its mood and focus and opens that day's editor, and per-level distributions for the month.

Mood and Focus are the reference configuration-defined trackers: one date-keyed record per day with independently loggable Mood (Great, Good, Neutral, Bad, Awful) and Focus (Locked In, High, Medium, Low, Locked Out, Resting). Either signal saves in one tap, and a missing signal differs from Resting. Quick capture accepts today and yesterday. The History editor accepts any past day in your saved time zone, never a future one, and a correction preserves the day's other rating. Agents save explicitly stated ratings directly and ask before saving an inferred one. Tracking stores ratings only; there is no written daily synthesis.

### Pomodoro

Pomodoro is a focus timer with its own page and a live countdown beside its sidebar entry. A session is a focus session, a short break, or a long break; at most one session runs or is paused at a time. Each session keeps its label, planned length, start, pauses, end, focused time, and local date. Preferences cover the three lengths, the number of focus sessions before a long break, and whether breaks and focus start automatically; changes apply to sessions started afterward.

Starting a focus session takes an optional label. A running session can be paused, resumed, or stopped early, which records the focused time and marks it stopped; a break can be skipped. When a session reaches its planned length, Manor completes it, plays the completion sound when sounds are on, and offers the next step in the cycle, or starts it when auto-start is on.

The page has Timer and History tabs. History shows month statistics (completed focus sessions, focused time, active days, sessions per active day, the best day, and consecutive days with a completed focus session) and the session log by day, newest first, with inline relabeling and deletion. The day streak is informational and isn't part of the streak system. Agents can query sessions with a range summary, start, pause, resume, end, relabel, and delete sessions, and log a focus session timed elsewhere with its start and duration.

### Problems

Problems is a general problem library, built so you never need to leave Manor to practice for coding interviews.

**The catalog.** Every account sees Manor's shared catalog of stock LeetCode problems and complete imported interview problems, with their statements, source details, and graders, as soon as it signs in. The catalog is read-only in the app and changes only through Manor's import tooling. Custom problems are private to your account, listed alongside the catalog, and created and edited through an agent; the app has no problem editor. Practice state, attempts, submissions, drafts, mistakes notes, and saved views belong to each account. Problem practice has no streak, freeze pool, or daily requirement.

**Finding problems.** Coding, system design, behavioral, and other problems share a compact index. Topics, companies, interview rounds, roles, collections, status, and last-asked dates combine as filters, and saved views keep filters, sorts, grouping, and visible columns, so a curriculum is a reusable view rather than the structure of the module.

- **Topics** come from one closed, two-level vocabulary. Categories modeled on NeetCode's roadmap (such as arrays and hashing, sliding window, or graphs) drive browsing, and each holds specific patterns defined by a rubric. A problem carries one to six patterns, and its categories follow from them.
- **Tags** hold only source evidence: interview round, role, employment type, and technology. The round is recorded only when the source reports it.
- **Difficulty** uses the official label where one exists; an inferred difficulty is shown as estimated. Sparse evidence leaves fields empty rather than inventing a precise classification.
- **Recency** keeps the reported last-asked date with its original precision, the reporting range, frequency, and report count. Company datasets keep their snapshot date and source separately, and the import date never counts as interview evidence.

**Content.** A problem has a stable identity separate from its content versions and practice history. Stock problems carry an original restatement with the same semantics, LeetCode's examples, constraints, follow-ups, progressive hints, an editorial, the familiar signature, and a saved testset, and keep a link to their source; stock content is checked against the original public problem, and one whose original can't be confirmed is removed rather than reconstructed. Every solution write-up ends with a validated Python reference solution. Imported problems preserve every functional requirement of their source with provenance; an incomplete question with a clear intent is finished into a well-defined problem whose added conventions are stated, and one with no determinable task is removed. Noncoding problems stay readable without an execution interface. Every catalog problem is either fully solvable or a fully written read-only problem.

**Duplicates.** Reviewed equivalent problems appear once under a canonical problem. Manor curates catalog groups, where an imported problem can join a stock one; agents group only your custom problems, and the app has no merge controls. Grouping preserves each source's identity, title, metadata, recency, and content, and can be undone. Practice never blocks a merge: once a source joins a group, its attempts, submissions, and drafts are ignored, and your status comes from your practice on the canonical problem.

**Solving.** A coding problem with a reviewed contract and current testset opens a workspace laid out like LeetCode's: a reader beside a code editor with completion, hover, and diagnostics, editable test cases, Run, Submit, and per-case results with your printed output. The reader has Description, Submissions, and Solution tabs; Solution shows the editorial directly. Most problems use a typed signature in C++, Python, JavaScript, Java, or Go with LeetCode's input format; problems defined around standard input also offer C. Custom coding problems can run supplied input before a testset exists, without an Accepted verdict. Code drafts are protected on the Mac as you type and saved to your account with conflict detection. Running and submitting need a connection; reading never does.

**Grading.** Testsets are versioned with the statement and record whether each case came from the source, you, or generation. Generated cases cover the stated constraints, boundaries, adversarial inputs, and checked random cases, with independently validated expected answers. Passing means passing Manor's saved testset, not a match to an unavailable original judge. Grading keeps the original answer semantics: answers in any order, floating-point values, and any-valid-answer problems are accepted whenever the original would accept them. A failed submission reveals its first failing case, including an otherwise hidden input, your output, the expected answer, and any printed output or errors; other hidden cases and checker code stay private.

**Practice records.** An accepted submission logs a dated attempt with its exact source, once per day and source. A manual solve or review adds an attempt with an editable past date. Mistakes notes hold short notes of up to 2,000 characters. Removing a catalog problem deletes it with every account's attempts, submissions, drafts, and practice state on it.

**Agents** can create and update your custom problems, import bounded batches, group and ungroup them, and save views; catalog problems are read-only to agents too. Source keys deduplicate repeated imports, and conflicting revisions require resolution.

### Jobs

Jobs has two views. **Pipeline** is the application board with the Flow chart of every tracked application below it. **Listings** is the SimplifyJobs catalog. A listing joins your pipeline only when you add it; nothing is imported automatically. Listings search and additive filters cover hiring cycle, category, company, location, posted date, and whether a listing is already in your pipeline, and view state survives navigation within the session.

The board runs To apply, Applied, OA, Interview 1, Interview 2, Interview 3, and Offer or Rejected. Roles share one editable schema: company, role, location, posting link, hiring cycle, posting date, stage, applied date, OA due date, OA completed date, three interview dates, decision date, and the resume version used. Unset values stay blank, and manual creation covers roles outside the feed. A role added from Listings keeps the listing's full location list and hiring cycle.

Moving a role across columns or through its stage menu opens the role dialog as an unsaved draft with the destination stage and its date control first. Grouped interview and decided drops require choosing the round or outcome; Manor never assumes rejection. **Cancel** leaves the role unchanged, and **Save** applies the stage and dates together. A role waiting on results after its online assessment reads as done rather than overdue, and **Mark OA done** sets today from the card menu.

Flow starts with every tracked application. Roles still at Applied branch to No response yet, and roles at OA, an interview, Offer, or Rejected branch to Responded; ribbon widths show the number of roles in each branch and stage move. A backwards stage correction removes the undone hops so repeated dragging can't inflate progress. Chart values are exposed to assistive technology.

Resume PDFs are private files, each version named by its file; roles reference the version used, and purging one role never deletes a shared file.

Ingestion reads SimplifyJobs' structured listings and keeps those that are visible, open, non-hardware, have at least one US location, and are for Fall 2026 or later when a cycle is given. Equivalent company, role, location, and cycle listings group with an openings count.

### Notes

Notes is a document workspace with drafts protected on the Mac and saves queued to the cloud. The target is rich note-taking: fundamentals, rich content, and editing feel. It doesn't extend Manor into databases, shared workspaces, or project management.

**Layout.** Notes has two panes: the note list and the editor. The list header's picker chooses the view (all notes, favorites, recent, archived, Trash, or a folder, with counts) and is where folders are created and renamed. The list collapses into a slim rail, remembered on the Mac. Returning to Notes during a session reopens the list and note you left; a relaunch opens Notes with no note selected. Moving between notes, starring, moving, trashing, and creating never wait for the cloud: the edit is protected on the Mac, the save continues in the background, and a note that fails to sync is offered back.

**Content.** Paragraphs, headings and toggle headings, bulleted, numbered, to-do, and toggle lists, quotes, dividers, callouts, highlighted code, inline formatting, links, text and background colors, tables, images, audio, video, files, page mentions, inline and block equations, a live table of contents, web bookmarks, embeds, column layouts, and in-document tabs. Document to-dos don't create Manor tasks. Images have captions, alt text, resizing, and cropping, and inserting, replacing, and recovering failed attachments are complete workflows. A block Manor can't display stays in the note unchanged.

**Editing.** Block selection, insertion, reordering by drag, duplication, moving to another note, conversion, slash commands, Markdown shortcuts, copy and paste, undo and redo, and contextual controls work consistently across content. Find in note (Command-F) highlights matches with next and previous navigation without changing anything. A link to one of the note's own headings jumps to it; web links open in the browser.

**The note list** is multi-select: Shift-click selects a range, Command-click toggles a note, Command-A selects the visible list, Escape clears, and Delete moves the selection to Trash, or deletes permanently inside Trash. A right-click menu carries the same actions. A move to Trash shows a toast with **Undo** while it can still be reversed. Moving a page to Trash includes its subpages.

**Concurrent edits** from another device or an agent merge by block when they touch different blocks; only edits to the same block ask you to compare versions and choose. Autosave failures stay visible and retryable.

**Versions and suggestions.** Version history shows seven days of meaningful document versions, separate from tool-only action history. Restoring a version creates a new current revision and keeps newer work in history. Suggestions that an agent proposed appear in a review dialog where you accept or reject each one, or all at once. Purging a note purges its versions and suggestions.

**Import and export.** Documents keep their full structure. Markdown is an explicitly lossy interchange format: math uses LaTeX, columns become sequential sections, tabs become headed sections, and bookmarks and embeds become links; exports disclose their losses. Manor can also export and import a lossless Manor document file. Importing Markdown in the app takes the text, and a document that opens with a heading is titled by it. A document whose images and files live beside it on disk is imported by an agent through Manor's tools, which convert the Markdown and place the uploaded files.

### Bookmarks

Bookmarks is the knowledge base: X bookmarks and agent-supplied captures in compact rows with search. X bookmarks, not likes, are ingested periodically in bookmark order, with linked article content where available. Captures carry source links, media, and processed content supplied by an agent or by you, saved as given without a second AI pass. Pending and failed captures show their state with retry. Text and semantic retrieval are available through agent tools.

### Fitness

Fitness ingestion is deferred. The intended pipeline is a short screen recording of the Bevel iPhone app, normalized by a backend job into calories in, out, and deficit and the muscle groups worked. Sleep stays a manual habit.

## Surfaces

- **Sidebar.** Docked by default with one toggle. Collapsed, it appears as a floating overlay when you point at the left edge and hides when you leave; the choice persists. It holds the modules, an update notice when one is ready, Settings, and the account menu.
- **Keyboard.** Command-1 through Command-7 switch modules in sidebar order, Command-comma opens Settings, Command-backslash toggles the sidebar, Command-N creates on Home, Tracking, Jobs, and Notes, Escape clears a search field before closing anything, and Space drives the Pomodoro timer. Settings lists every shortcut, including Alfred's.
- **Navigation state.** Switching modules and returning keeps the open item, filters, scroll position, and unfinished controls for the signed-in session. Problems also keeps open workspaces with their language, editor state, custom cases, and results. Relaunching, signing out, or switching accounts clears this temporary state; saved preferences and protected drafts follow their own rules.
- **Object details** are centered dialogs. Side peeks, drawers, sheets, right-edge detail panels, and detail rails are prohibited; page layouts, the sidebar, inline popovers, menus, and tooltips are unaffected.
- **Product surfaces.** Gated signup and sign-in, Settings (account, appearance, connections, Alfred, shortcuts, and about), agent connection approval, recovery and Trash, and designed empty states. There is no activity page.
- **iOS, later.** A native companion, primarily for notifications, with capture, widgets, and HealthKit relay scoped later.

## Design

Manor's look is a smooth, native Mac product: SF Pro for interface and reading text, Outfit for titles, a plum and gray palette, and deliberately designed light and dark modes. The theme preference is system, light, dark, or day and night, which is light from 6 AM to 6 PM local time. Notes editing uses contextual controls in Manor's visual language. There are no mascots or characters. The [design charter](DESIGN.md) owns the rules.

## Scope

**Non-goals:** a web app or web view shell; unrestricted agent database access; an assistant that changes your Manor records unasked or outside Manor's commands; a Journal or any private encrypted writing surface; an AI-written daily synthesis; a user-facing action log; multi-user collaboration, teams, or sharing; a general-purpose collaborative workspace; a standalone calendar workspace; mascots or characters.

**Deferred:** a native iOS companion and proactive notifications; custom tracker creation; fitness ingestion until its schemas are agreed; finance and media modules; additional jobs sources; Google Calendar push updates and iCloud CalDAV.

## Open product questions

- The jobs catalog keeps its standing filters, including the Fall 2026 cycle cutoff, until they are explicitly revised.

Remaining technical work is listed in the architecture's [status](ARCHITECTURE.md#status) section.
