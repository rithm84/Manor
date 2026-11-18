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

## Status after the 2026-11-18 session

Steps 1 to 7 of the earlier plan are done on `native-macos` (see `git log`): /alfred in Notes, in-app Alfred
with Manor tools, Manor-themed pickers (and the popover sizing fix), a full sandbox QA pass with its fixes,
page-switch performance (about 80 ms to about 30 ms on the VM), the dead-code sweep, docs, and native README
screenshots. The sidebar now matches the system sidebar (window buttons inside it, unified toolbar), and the
Tracking History trend is two charts.

What remains:

1. **Release 0.2.0 and the production cutover** on the owner's Mac: `.claude/release-0.2.0/CHECKLIST.md`
   (notes in `NOTES.md`). Production is untouched. Delete `.claude/handoff/` and `.claude/release-0.2.0/` after.
2. **Verify with a real OpenAI key** (owner's Mac): in-app Alfred and /alfred were exercised only with the
   scripted demo writer (`ALFRED_NOTES_DEMO=1`), never against the live model.
3. **Open QA items not fixed** (lower severity): Alfred diagram index labels render below 12 pt; typing
   `/alfred` very quickly can skip the slash menu; date formats differ between pages ("Fri, 20 Nov" vs
   "Nov 16, 2026"); offline uploads of note attachments are not protected locally (`NoteDraftStore`'s
   attachment API is unwired); first visits to Notes and Problems take about 200 to 290 ms on the VM; the
   floating hover sidebar and the image block options dialog, Bookmarks, Pomodoro controls, and habit
   create/edit/delete were not re-tested in the last QA pass.

## Known gaps

- The staging Google OAuth client has a redirect mismatch; sign in with `staging-session.sh` instead.
- Staging seed: one recurring series uses BYDAY=SU on Tuesday dates, so "this and future" edits move it to
  Sunday. Seed issue, not an app bug.
- Leftover staging QA data (mood rows Nov 10, 16, 17, a Two Sum submission, trashed QA task and notes, a split
  series) is harmless.
