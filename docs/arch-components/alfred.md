# Alfred

_Last updated: 2026-11-19_

[Back to Manor architecture](../ARCHITECTURE.md)

Alfred is Manor's personal assistant: a notch overlay and a menu bar item that run inside Manor's process. The product behavior is in the PRD's [Alfred](../PRD.md#alfred) section. This slice covers how it is built and hosted.

## Target and boundaries

Alfred is the `Alfred` Swift target in `macos/Sources/Alfred/`. It has no package dependencies and doesn't depend on `ManorKit`; it links AVFoundation, Carbon, and ScreenCaptureKit. The Manor app depends on it, never the other way round.

| Folder | Holds |
|---|---|
| `Host` | `AlfredHost`, the state model, the menu bar item, settings models, and `AlfredWriter` |
| `Audio`, `Capture` | Microphone and system-audio capture, PCM conversion, and screenshots |
| `Transcription` | Deepgram Flux streaming, the listener, and the transcript |
| `Intelligence` | The answer and context engines, prompts, and the Anthropic and OpenAI clients |
| `Core` | Configuration, hot keys, the Keychain store, knowledge, preferences, and logging |
| `UI` | The overlay, Markdown, the diagram language, generative UI, theme, and the embeddable views |
| `Debug` | Demo content and snapshot rendering, enabled only by environment variables |

Alfred never reads or writes Manor's account data or calls Manor's backend. Its only shared surfaces with the app are the host API, the Settings section, and the Notes writer.

## Runtime

The following diagram shows how one answer is produced.

![Alfred's runtime inside Manor's process: a hot key, the menu bar, or the notch starts an answer; in Prep mode, system audio (the other side) and the microphone (you) stream to Deepgram Flux, whose transcript feeds the context engine's rolling memory and open question; the answer engine combines that with an image and the text of the window you are working in and your knowledge documents, streams from Claude Opus 5.5 in fast mode with your own Anthropic key, with a GPT-6 Luna topic router on your OpenAI key, and renders in the notch overlay as Markdown, diagrams, and generative UI; AlfredWriter streams an /alfred block into a note from the note's title and nearby text only; with Manor in front, the hot key opens Alfred in Manor instead, which calls the same model with Manor's tools and shows each action with Undo.](../diagrams/svg/alfred-runtime.svg)

<details><summary>Diagram key</summary>

![Diagram key of the nine node roles: people and surfaces, the Manor Mac app, local storage and sync, Supabase and durable data, agents and AI models, external providers, background and async work, checks and gates, and neutral or closed.](../diagrams/svg/_key.svg)

</details>
<p></p>

### Modes

The mode is saved per Mac (`manor.alfred.mode`).

- **General** never listens. An answer always includes a screenshot when Screen Recording is allowed and opens a typed question otherwise. Quick actions are Answer, Explain, Summarize, and Visualize over the screen and the chat. The background context pass is off.
- **Prep** runs live listening. Switching to it starts listening when a Deepgram key exists. Quick actions are Answer, Diagram, Follow-ups, and Recap, with answer styles for interview, coding, system design, and meeting, and DSA-focused prompts.

### Capture

- **Screen.** `WindowCapture` finds the topmost ordinary window that isn't Manor's in the window server's front-to-back list, so asking from the notch (which can make Manor the active app) still captures what you were looking at. It captures only that window with `SCContentFilter(desktopIndependentWindow:)` and sends a JPEG of at most 2048 pixels on its longest edge, with the app's name and the window's title. At the same time `WindowText` reads the window's text through the Accessibility API: static text, text areas and fields, headings, web content, and the current selection, never secure text fields, capped at 12,000 characters and 0.4 seconds with a 0.25-second messaging timeout. It sets `AXManualAccessibility` so Chromium and Electron apps expose their content; nothing on screen changes. The prompt quotes the text as content from the screen, not instructions. Without Accessibility, answers use the image alone; with no other window, `ScreenCapture` falls back to the display under the pointer without Manor's windows.
- **System audio** comes from a ScreenCaptureKit stream with audio capture on and the current process excluded, at 16 kHz mono; it is labeled as the other side.
- **Microphone** is an `AVAudioEngine` input tap, read-only, with no voice processing, rebuilt when the input device changes; it is labeled as you. Speakers come from the source, not from diarization, and an interviewer's voice that leaks into the microphone is removed from your side of the transcript.

### Transcription and context

`DeepgramFlux` streams 80-millisecond linear PCM chunks over WebSocket to Deepgram's Flux model (`flux-general-en` by default) and reconnects with up to about 15 seconds of buffered audio replayed. `ContextEngine` runs shortly after each finished turn, folds older turns into a rolling memory while keeping a verbatim tail, and detects the open question as a brief. When an interviewer's question ends, the answer engine starts a speculative answer in a hidden lane, so pressing Answer often shows it at once in the visible lane.

### Answers

`AnswerEngine` keeps up to five chat tabs, each sending its last 15 exchanges as history. A topic router decides when the conversation or screen has moved to a new problem and opens a new tab for it. Every prompt includes the enabled knowledge documents, up to 60,000 characters, plus your role context and extra instructions.

In Prep mode, the interview, coding, and system design answer styles share a clarify-first rule (`Prompts.clarifyFirst`). The answering model applies it itself, from the transcript, memory, screen, and chat history, so a prepared answer follows it too. When the interviewer has just posed a problem that leaves open something that changes the solution, which nobody has settled or asked about, the reply is two to four questions to ask, each with why it matters, and the assumption to state if they stay open. The next answer, after the interviewer replies or you ask again, solves the problem. A typed request or quick action never gets the questions.

| Use | Default model |
|---|---|
| Answers, conversation memory, the Notes writer, and Alfred in Manor | Claude Opus 5.5 in fast mode, low effort |
| New-topic router | GPT-6 Luna on OpenAI's priority tier without reasoning; off without an OpenAI key or with `ALFRED_ROUTER_MODEL=off` |

Anthropic runs everything that reasons; OpenAI only answers the router's yes-or-no question. The memory pass stays on Claude: measured on the same transcripts, it was faster than GPT-6 Luna and followed the prompt more closely ([benchmarks](benchmarks.md#alfred-answers)). `AnthropicClient` streams the Anthropic Messages API: the instructions go in a cached system block, low effort bounds Claude Opus 5.5's always-on thinking (only its text reaches the answer), the fast tier becomes `speed: "fast"`, and a classifier refusal is retried on Anthropic's recommended fallback model (`fallbacks: "default"`). `OpenAIClient` streams the OpenAI Responses API with `store: false` for the router. `Config.makeClient(for:)` builds the client for a provider. Answers are capped at 6,000 output tokens, plus room for Claude's thinking.

## Rendering

The overlay renders Markdown with a small streaming parser and a syntax highlighter, and two fenced languages that Alfred draws natively as they stream:

- **` ```diagram `** is Alfred's line-oriented diagram language for data structures (arrays, strings, sets, stacks, queues, lists, trees, heaps, tries, grids, maps, bars, intervals, and graphs) and flowcharts, with pointers, highlights, windows, arrows, paths, and `step` lines that make step-throughs. It runs as a pure parser, a pure layout pass, and a Canvas view, with an audit that checks for collisions.
- **` ```ui `** is Alfred's generative UI language: layout, text, data, and chart components drawn with SwiftUI and Swift Charts. Finished statements keep their identity while the tail streams, and a final pass matches a whole-text parse.

`UI/Embedding.swift` exposes `AlfredContentView`, `AlfredDiagramView`, and `AlfredGenerativeView`, which render on a normal document background in light and dark for embedding in notes.

## Overlay and menu bar

- **Overlay.** `OverlayController` owns a borderless, non-activating `NSPanel` above the menu bar level that joins every Space and works beside full-screen apps. It ignores the mouse except inside registered hit regions, so it never blocks the app beneath. A black, hardware-style card springs from the notch and folds back; on a Mac without a notch, it hangs from the top center and fades when hidden.
- **Menu bar.** `StatusMenu` shows a template Manor mark with a dot while listening. Its menu holds the mode, Ask, Answer, listening and microphone controls (Interview only), New Session, the mode submenu, **Alfred Settings…**, **Open Manor**, and **Quit Manor**.
- **Hot keys.** `HotkeyCenter` registers Carbon hot keys, which need no Accessibility permission. All use Control-Option: Space answers, L and M toggle listening and the microphone, H opens or folds the overlay, N starts a new session, T and W open and close chat tabs, the arrow keys scroll and switch tabs, brackets step through diagrams, and comma opens Settings. A shortcut that another app already holds is flagged in Settings.

## Hosting inside Manor

`AlfredHost.shared` is the host API: `start(_:)` with the app's actions (open Manor, open Settings, quit, and `handleInApp`, which sees each hot key first), `stop()`, `mode`, `keepsRunningWhenManorQuits`, preferences, knowledge, and settings. `AppDelegate` starts it through `AlfredBridge` when launch finishes and stops it when Manor terminates, which saves the session, unregisters hot keys, and stops listening. Listening starts at launch only when Prep mode and **Listen when Manor opens** are both on.

### Quitting and reopening

`AlfredBridge` (`Manor/App/AlfredBridge.swift`) implements the Prep-mode quit rule:

- **Dock Quit or Command-Q in Prep mode** cancels termination, orders out Manor's windows, and switches to the accessory activation policy, so the Dock icon disappears while the menu bar item keeps Alfred running.
- **Open Manor**, a Dock reopen, or reopening from Finder restores the regular activation policy and the window.
- **Quit Manor** from Alfred's menu quits for real.
- **Logout, restart, and shutdown**, detected from the Apple event's quit reason, always quit.
- **Installing an update** allows the quit before the updater relaunches (see [releases and updates](releases-and-updates.md)).

In General mode, quitting behaves normally.

## Alfred in Manor

When a hot key fires, `AlfredHost` offers it to the app's `handleInApp` action before the overlay. `AlfredDialogModel` (`Manor/Modules/Alfred/AlfredDialog.swift`) takes Control-Option-H, and Control-Option-Space in General mode, when Manor is active and its key window is a main window rather than a panel. It then toggles a centered Manor dialog, and otherwise the overlay handles the key as usual. The View menu's **Ask Alfred** command opens the same dialog.

The dialog drives `AlfredAssistant` (`Alfred/Host/AlfredAssistant.swift`), a conversation model that knows nothing about Manor's data:

1. On each message it asks the host's `AlfredToolbox` for an `AlfredAppSnapshot`: the page and a compact text summary with record IDs, capped at 4,000 characters.
2. It streams a Messages API request with the toolbox's tools as tool definitions (`AnthropicClient.streamMessage`, which rebuilds each finished content block). Each round's assistant content, thinking blocks included, is appended unchanged with the tool results after it, so the model's reasoning carries between rounds.
3. It validates each function call against the tool's JSON Schema and runs it through the toolbox. Tools with an `AlfredToolConfirmation` wait for the user's approval in the conversation first.
4. It sends every output of a round back in one message and repeats, up to eight rounds per message.

Each successful action becomes a row carrying the tool's `undo` closure. Failures go back to the model only, so it explains or asks. Earlier turns are kept as compact request-and-reply text, including what was done and later undone, so follow-ups have context without resending old tool traffic. It runs on the answer model, Claude Opus 5.5 in fast mode.

`ManorAlfredToolbox` (`Manor/Modules/AlfredTools/`) implements the toolbox over `ManorToolCatalog` (`ManorKit/Domain/AlfredTools/`). Writes go through `Gateway.command` with the same inputs the pages send. References resolve through `ManorTargetMatcher`, which fails with the candidates when a reference names several records or none. Every write returns an inverse for Undo, except ending a Pomodoro session, which confirms first. Debug builds launched with `ALFRED_NOTES_DEMO=1` script the model's turns so the dialog can be reviewed without a key; the scripted turns still call the real tools.

## Keys, data, and logs

- **Keys.** `KeyStore` keeps `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `DEEPGRAM_API_KEY` as generic passwords under the Keychain service `app.manor.alfred.api-keys`. **Check and Save** validates each with its provider before storing it. Precedence is the process environment, then the Keychain, then `~/Library/Application Support/Manor/Alfred/.env.local`, then, for builds made from a checkout on this Mac, `macos/.env.local` and the repository's `.env.local`. Keys go only to their own provider.
- **Data on this Mac** lives under `~/Library/Application Support/Manor/Alfred/`: `knowledge.json` for personal context (résumé, experience, job descriptions, and notes, imported from PDF, Word, RTF, HTML, Markdown, or text) and `Sessions/` for saved Markdown sessions.
- **Preferences** are `UserDefaults` keys under `manor.alfred.`: mode, interview style, coding language, role context, extra instructions, text scale, microphone capture, listen on launch, save sessions, prepare answers early, and include screen.
- **Logs** use the subsystem `app.manor` and category `alfred` and never contain keys, transcripts, or screenshots.

## Permissions

Permissions belong to Manor's bundle. The build script writes `NSMicrophoneUsageDescription` and `NSScreenCaptureUsageDescription` into `Info.plist` and signs with `Resources/Manor.entitlements`, whose `com.apple.security.device.audio-input` entitlement lets the hardened runtime read the microphone. Each permission is requested the first time Alfred needs it, and Settings links to the matching System Settings pane for each permission. Reading window text needs Accessibility, which Settings requests from its "Read the window's text" row. Screenshots exclude Manor's own windows.

## Settings

**Settings > Alfred** (`Manor/Modules/Alfred/`) covers the mode, including the screen, answer text size, interview options, personal context (`AlfredKnowledgeCard`), keys (`AlfredKeysCard`), the models in use, permissions, shortcuts, and saved sessions. `manor://settings/alfred` and Alfred's own **Alfred Settings…** item open it.

## Notes writer

`AlfredWriter.shared.write(_:in:)` takes a request and a `DocumentContext` (the note's title, the text before and after the cursor, any selection, the block's request history, and its current source) and returns a stream of Markdown deltas. It uses the answer model and your knowledge and instructions, never captures the screen or audio, and trims context to a few thousand characters. A refinement returns the full revised block rather than a patch. The Notes editor turns the stream into an `alfred` block or a selection preview, described in [Notes editor](notes-editor.md#alfred-blocks). The `purpose` (insert, refine a block, or rewrite an inline or block selection) shapes the instructions, and requests carry up to six downscaled images.

## Tests

`Tests/AlfredTests` covers configuration parsing and defaults, Markdown, server-sent events and request bodies, transcript echo removal, the context engine, the knowledge budget, the diagram parser, layout, readability, step-throughs and flowcharts, prefetch matching, overlay edit shortcuts, chat tabs, the router, and generative UI parsing and streaming, plus the Responses output-item parser and `AlfredAssistant`'s action, Undo, and confirmation flow against a scripted toolbox. `ManorKitTests` covers the Manor tool catalog and argument parsing. Host wiring, capture, and the Keychain are verified by running the app (see [testing and QA](testing-and-qa.md)).
