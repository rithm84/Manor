#!/bin/bash
# Prepares a Claude Code cloud session to continue the problem content pipeline.
# Requires environment variables SUPABASE_ACCESS_TOKEN, BLAXEL_API_KEY, BLAXEL_WORKSPACE,
# MANOR_STAGING_WORKER_SECRET, and TYPESAFE_AI_API_KEY. Private working data is pulled from the
# staging project's private Storage bucket; nothing private is written into the repository.
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
DATA="$HOME/manor-problem-work"
echo "== Checking environment variables"
for name in SUPABASE_ACCESS_TOKEN BLAXEL_API_KEY BLAXEL_WORKSPACE MANOR_STAGING_WORKER_SECRET TYPESAFE_AI_API_KEY; do
  if [ -z "${!name:-}" ]; then echo "Missing environment variable $name" >&2; exit 1; fi
done

step() { echo "== $*"; }

# The tooling imports TypeScript directly, which Node supports without flags from 22.18 and 23.6.
step "Checking Node and Python"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=6)||(a===22&&b>=18)?0:1)'; then
  step "Installing Node 24 under \$HOME/.n (found $(node --version))"
  export N_PREFIX="$HOME/.n"
  npx --yes n 24
  export PATH="$N_PREFIX/bin:$PATH"
  grep -q 'N_PREFIX' "$HOME/.bashrc" 2>/dev/null || printf '%s\n' 'export N_PREFIX="$HOME/.n"' 'export PATH="$N_PREFIX/bin:$PATH"' >> "$HOME/.bashrc"
fi
node --version
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or later is required"; print(sys.version.split()[0])'

step "Installing dependencies"
npm ci --prefix "$REPO/app" --no-audit --no-fund
npm ci --prefix "$REPO/tools/problem-import" --no-audit --no-fund
npm ci --prefix "$REPO/tools/problem-runner" --no-audit --no-fund
npm ci --prefix "$REPO/tools/diagrams" --no-audit --no-fund

step "Logging in to Supabase"
"$REPO/app/node_modules/.bin/supabase" login --token "$SUPABASE_ACCESS_TOKEN" >/dev/null
umask 077
printf '%s\n' "BLAXEL_API_KEY=$BLAXEL_API_KEY" "BLAXEL_WORKSPACE=$BLAXEL_WORKSPACE" "MANOR_STAGING_WORKER_SECRET=$MANOR_STAGING_WORKER_SECRET" "TYPESAFE_AI_API_KEY=$TYPESAFE_AI_API_KEY" > "$REPO/.env.local"

step "Pulling private data"
mkdir -p "$DATA"
node "$REPO/tools/problem-import/workdata.mjs" pull "$DATA" --project-ref cysdooljdslgvqrahymm

# The private tooling finds the repository through this file; it is never synced to the bucket.
printf '%s\n' "$REPO" > "$DATA/work/.repo"
# Cloud containers allow only outbound HTTPS, so staging SQL goes through the Management API instead of a Postgres connection.
echo "Problem pipeline ready: repository $REPO, data $DATA, handoff notes $DATA/work/CLOUD-HANDOFF.md"
echo "Export MANOR_SQL_TRANSPORT=https in each command that runs staging SQL (import.mjs, import_ready.py, stage-sql.sh)"
