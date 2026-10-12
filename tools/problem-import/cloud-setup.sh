#!/bin/bash
# Prepares a Claude Code cloud session to continue the problem content pipeline.
# Requires environment variables SUPABASE_ACCESS_TOKEN, BLAXEL_API_KEY, BLAXEL_WORKSPACE,
# MANOR_STAGING_WORKER_SECRET, and TYPESAFE_AI_API_KEY. Private working data is pulled from the
# staging project's private Storage bucket; nothing private is written into the repository.
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
DATA="$HOME/manor-problem-work"
for name in SUPABASE_ACCESS_TOKEN BLAXEL_API_KEY BLAXEL_WORKSPACE MANOR_STAGING_WORKER_SECRET TYPESAFE_AI_API_KEY; do
  if [ -z "${!name:-}" ]; then echo "Missing environment variable $name" >&2; exit 1; fi
done

# The tooling imports TypeScript directly, which needs Node 24.
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  npm install --global n >/dev/null && n 24 >/dev/null && hash -r
fi
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or later is required"'

npm ci --prefix "$REPO/app" --no-audit --no-fund
npm ci --prefix "$REPO/tools/problem-import" --no-audit --no-fund
npm ci --prefix "$REPO/tools/problem-runner" --no-audit --no-fund
npm ci --prefix "$REPO/tools/diagrams" --no-audit --no-fund

"$REPO/app/node_modules/.bin/supabase" login --token "$SUPABASE_ACCESS_TOKEN" >/dev/null
umask 077
printf '%s\n' "BLAXEL_API_KEY=$BLAXEL_API_KEY" "BLAXEL_WORKSPACE=$BLAXEL_WORKSPACE" "MANOR_STAGING_WORKER_SECRET=$MANOR_STAGING_WORKER_SECRET" "TYPESAFE_AI_API_KEY=$TYPESAFE_AI_API_KEY" > "$REPO/.env.local"

mkdir -p "$DATA"
node "$REPO/tools/problem-import/workdata.mjs" pull "$DATA" --project-ref cysdooljdslgvqrahymm

# The private tooling and the authoring guides use these absolute paths.
if [ -w / ]; then mkdir -p /Users/rithvik/Projects; else sudo mkdir -p /Users/rithvik/Projects && sudo chown "$(id -u)" /Users/rithvik /Users/rithvik/Projects; fi
ln -sfn "$REPO" /Users/rithvik/Projects/Manor
ln -sfn "$DATA" /Users/rithvik/Manor-handoff-2026-10-12
echo "Problem pipeline ready: data in $DATA, handoff notes in $DATA/work/CLOUD-HANDOFF.md"
