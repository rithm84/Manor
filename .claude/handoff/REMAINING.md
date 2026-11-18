# Native Manor: remaining work (handoff, 2026-11-17)

Temporary agent handoff. Delete `.claude/handoff/` before the 0.2.0 release. Read AGENTS.md first; its rules
bind (secrets, staging only, docs style, no removed third-party names).

## Where things stand

- Branch `native-macos`: the native SwiftUI and AppKit app in `macos/` replaces the Tauri app (`app/`,
  `desktop/` deleted). `swift build --package-path macos` is clean and `swift test --package-path macos`
  passes (370 tests in 77 suites) on Xcode 27.2 / Swift 6.4.2.
- Docs are rewritten (PRD, DECISIONS, ARCHITECTURE, arch-components, DESIGN, Pele diagrams).
- Backend: migration `20261117120000_remove_daily_synthesis_and_alfred.sql` (synthesis and the old assistant
  removed; `commit_debrief` became `log_daily_ratings`) is applied to STAGING only. Staging Edge Functions
  deployed: manor-mcp v47, integrations v22, integration-callback v20. Production is untouched.
- Two QA passes ran in the Daytona sandbox (`qa-findings.md`); about 40 fixes landed.

## Building and QA from a cloud (Linux) session

Linux cannot compile SwiftUI or AppKit. Build, run, and QA on the Daytona macOS sandbox:

- `python3 tools/sandbox/dt.py create` finds the persistent sandbox `manor-native-test` by name (macOS 26.6,
  Xcode 26.6, Swift 6.3, Liquid Glass available). It never buys a reservation; the owner allows 24-hour
  reservations only, never more. The current reservation started 2026-11-17 and expires about 24 hours later.
  If it is gone, stop and ask the owner.
- `tools/sandbox/deploy.sh` uploads `macos/`, builds `Manor Staging.app` there, launches it, and signs in as
  `showroom@example.invalid` (staging synthetic account with seeded data).
- `dt.py shot out.png 0.5`, `click X Y`, `type`, `key`, `scroll`, `drag`, `exec` drive it. Screen 1280x800.
- Swift 6.3 in the sandbox is older than the owner's 6.4.2: keep code compiling on both.
- `tools/sandbox/cloud-setup.sh` is the cloud environment setup script (installs tooling; safe to rerun).
- `tools/sandbox/staging-config.sh` writes the ignored `macos/config/staging.env` from SUPABASE_ACCESS_TOKEN.
- Do not put the owner's Alfred API keys (OpenAI and others) into the sandbox without asking. Alfred UI states
  that need no live model (composer, empty, error, settings) can be QA'd without keys.

## Remaining work, in order

1. **/alfred in Notes** (spec: `ALFRED-IN-NOTES.md`). Partial code exists in
   `macos/Sources/Manor/Modules/Notes/Editor/NoteAlfred*.swift`, `NoteEditorController+Alfred*.swift`, and
   `macos/Sources/ManorKit/Domain/NoteDocument/NoteAlfred.swift`; the agent writing it stopped mid-way. Audit
   against the spec and finish: composer with images, Alfred block rendered with native block views,
   thinking animation, refine, Try again/Copy/Delete/Turn into regular blocks, selection editing (Command-J,
   toolbar, block menu, chips, preview Replace/Insert below/Try again/Discard). Check `supabase/functions`
   note text extraction and Markdown export handle the `alfred`, `diagram`, and `generativeUI` blocks; deploy
   any backend change to staging only.
2. **In-app Alfred** (owner request): when Manor is the frontmost key window, the Alfred shortcut opens a
   centered Manor dialog instead of the notch overlay, and Alfred can act on Manor ("check these things
   off"). Partial code: `macos/Sources/ManorKit/Domain/AlfredTools/`, `macos/Sources/Manor/Modules/AlfredTools/`
   (`ManorAlfredToolbox+*.swift`), `AlfredToolCatalogTests`. Audit, finish, wire through
   `macos/Sources/Manor/App/AlfredBridge.swift`, and confirm destructive actions confirm or offer Undo.
3. **Manor-themed pickers**: replace every system `DatePicker` and `Picker` (still in HomeStyle,
   ProblemViewDialogs, DayEditorDialog, JobsBrowseView, JobsComponents, NotesDialogs, NoteEditor,
   TrackingHistoryView, TrackingTrendChart, AlfredSettingsSection, AlfredKnowledgeCard) with custom Manor
   date, time, and select pickers in `macos/Sources/Manor/Design/Components/Pickers/` (partial; math in
   `ManorKit/Domain/Pickers`, tests in `PickerMathTests`). Light and dark, keyboard operable. Then remove
   `Design/Components/CalendarFocus.swift` if nothing uses it.
4. **Sandbox QA** of 1 to 3 plus a regression pass with `QA-MATRIX.md` (both themes, windowed and full
   screen, Reduce Motion, Increase Contrast, Reduce Transparency). Alfred: notch overlay and menu bar with
   other apps frontmost, General and Prep modes, quitting Manor from the Dock in Prep mode keeps
   the menu bar item and Alfred working.
5. **Performance**: measure launch (old Tauri baseline about 300 ms to first paint), page switches, scrolling
   long lists and long notes, and memory at idle and after visiting every page; fix hot spots. Native over
   heavy dependencies.
6. **Repo hygiene**: remove root `tmp/` and the stray root `node_modules/` (ask first; both are local junk
   only on the owner's Mac and may not exist in a clone). Never touch `output/` (private, ignored). Dead code
   sweep (unused types, files, assets), final grep that BlockNote, OpenUI, OpenCluely, Mixpanel, and Blitz
   appear nowhere except applied migrations.
7. **Docs**: update PRD, ARCHITECTURE, `docs/arch-components/alfred.md` and `notes-editor.md` for in-app
   Alfred and /alfred; native screenshots for the README (from the sandbox, showroom account).
8. **Release 0.2.0** (owner's Mac only; needs the signing certificate and the update key, so a cloud session
   prepares and the owner runs): `macos/scripts/release.sh production 0.2.0 notes.md`. Production cutover,
   each step confirmed with the owner first: count production synthesis text and assistant rows, apply
   migration `20261117120000` to production, deploy manor-mcp, integrations, and integration-callback to
   production, update `tools/recovery/current-status.json`. Tauri 0.1.x installs cannot read the new update
   feed, so the owner installs 0.2.0 by hand once.

## Known gaps

- The staging Google OAuth client has a redirect mismatch; sign in with `staging-session.sh` instead.
- Staging seed: one recurring series uses BYDAY=SU on Tuesday dates, so "this and future" edits move it to
  Sunday. Seed issue, not an app bug.
- Leftover staging QA data (mood rows Nov 10, 16, 17, a Two Sum submission, trashed QA task and notes, a split
  series) is harmless.
