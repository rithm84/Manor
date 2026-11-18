# Manor 0.2.0: what's left (owner's Mac)

Done from the cloud session on 2026-11-18:

- `main` fast-forwarded to `native-macos`.
- Production backend: migration `20261117120000_remove_daily_synthesis_and_alfred` applied and recorded (production
  had no synthesis text; 28 old Alfred memories and 20 Alfred actions were removed; the 2026-11-17 daily backup
  predates it), database functions verified identical to staging, and `manor-mcp`, `integrations`, and
  `integration-callback` deployed (JWT verification off, as before). `tools/recovery/current-status.json` updated.

Left for your Mac, which holds the Manor Signing certificate and the update key:

1. In the repository, from a clean tree:

   ```bash
   git fetch origin && git switch main && git pull --ff-only
   ```

2. Publish 0.2.0 and install it (checks prerequisites first; your old Manor goes to the Trash):

   ```bash
   macos/scripts/release-and-install.sh 0.2.0 .claude/release-0.2.0/NOTES.md
   ```

3. Sign in with Google when Manor opens, then add your OpenAI key (and Deepgram for Prep mode) in
   Settings > Alfred. Try Control-Option-H ("what's due today?") and `/alfred` in a note: both were only
   exercised with the scripted demo writer in the sandbox.

4. On your other Macs, download Manor 0.2.0 from the GitHub release once (0.1.x can't install it by itself); later
   updates install automatically.

5. Afterwards, delete `.claude/handoff/` and `.claude/release-0.2.0/` in a commit.
