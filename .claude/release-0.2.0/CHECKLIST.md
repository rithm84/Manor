# Manor 0.2.0 release and production cutover (owner's Mac)

Everything here runs on your Mac: it needs the Manor Signing certificate, the update key at
`~/.config/manor/update_ed25519.key`, `macos/config/production.env`, and production credentials. Nothing below has
been run against production. Confirm each production step before running it.

## 1. Build gate

1. `git fetch origin && git switch native-macos && git pull`
2. `swift build --package-path macos` and `swift test --package-path macos` on Swift 6.4.2 (the sandbox verified
   Swift 6.3: 371 Swift Testing tests in 77 suites and 84 XCTests passed).
3. `macos/scripts/build-app.sh staging --open`, sign in with `macos/scripts/staging-session.sh`, and spot-check:
   Control-Option-H in Manor (in-app Alfred), `/alfred` in a note, a date picker, and the sidebar in both themes.
   With your OpenAI key in Settings > Alfred, try one real in-app request ("what's due today?") and one action
   with Undo. Those paths were only exercised with the scripted demo writer in the sandbox.

## 2. Merge

`native-macos` is ahead of `main` and fast-forwards (`git switch main && git merge --ff-only native-macos && git push`).
Release from `main` so the release commit lands there.

## 3. Production backend (confirm each step)

1. Back up: run the recovery tooling's encrypted backup (`tools/recovery/README.md`).
2. Count what the migration deletes, for the record: rows with synthesis text in the daily records and history,
   and rows in the old assistant tables (see the top of `supabase/migrations/20261117120000_remove_daily_synthesis_and_alfred.sql`).
3. Apply `20261117120000_remove_daily_synthesis_and_alfred.sql` to production (`pxdxqueevzttpmxjsqes`) through the
   session pooler, and record it in the migration history.
4. Deploy the Edge Functions that changed: `manor-mcp` (Markdown import now maps diagram and UI fences),
   `integrations`, and `integration-callback`:
   `npx supabase@2 functions deploy manor-mcp integrations integration-callback --project-ref pxdxqueevzttpmxjsqes --use-api`
   Then check that each still has JWT verification off, as on staging.
5. Update `tools/recovery/current-status.json`: mark the migration `applied_and_recorded` on production and
   rewrite the `daily_synthesis_and_alfred_removed` note.
6. Smoke test production with the 0.2.0 build: sign in, check a habit, log a daily rating, open a note, ask Codex
   to read a note through MCP.

## 4. Release

1. `macos/scripts/release.sh production 0.2.0 .claude/release-0.2.0/NOTES.md` (the tree must be clean; it commits
   `VERSION`, tags `v0.2.0`, and publishes the archive and `manor-update.json`).
2. Tauri 0.1.x installs can't read the new update feed: install 0.2.0 by hand once on each Mac (download, drag to
   Applications, approve in Gatekeeper since the build isn't notarized).
3. Delete `.claude/handoff/` and `.claude/release-0.2.0/` in a follow-up commit; then
   `grep -rniE "blocknote|openui|opencluely|mixpanel|blitz" --exclude-dir=node_modules --exclude-dir=.git .`
   should only match applied migrations.
4. Update ARCHITECTURE's "Status" (production migration applied) and the PRD stamp if anything changed.
