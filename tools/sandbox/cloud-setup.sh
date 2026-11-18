#!/usr/bin/env bash
# Setup for a Manor cloud (Linux) session. Linux cannot build the SwiftUI app, so this installs only what a
# cloud session needs: backend tooling, docs diagram rendering, and the Daytona client that builds and drives
# the app on the remote macOS sandbox (tools/sandbox/). Secrets come from the environment; nothing is printed.
set -uo pipefail

REPO=""
for d in "$PWD" "$HOME"/* /workspace/* /home/*/*; do
  if [[ -f "$d/macos/Package.swift" && -d "$d/supabase/migrations" ]]; then REPO="$d"; break; fi
done
[[ -n "$REPO" ]] || { echo "Manor checkout not found"; exit 0; }
cd "$REPO"
echo "Manor at $REPO ($(git rev-parse --abbrev-ref HEAD 2>/dev/null))"

install() { # npm ci when a lockfile exists, otherwise npm install
  local dir="$1"
  [[ -f "$dir/package.json" ]] || return 0
  if [[ -f "$dir/package-lock.json" ]]; then npm ci --prefix "$dir" --no-audit --no-fund >/dev/null 2>&1
  else npm install --prefix "$dir" --no-audit --no-fund >/dev/null 2>&1; fi && echo "npm: $dir" || echo "npm failed: $dir"
}
for dir in supabase tools/problem-import tools/problem-runner tools/recovery docs/diagrams; do install "$dir"; done

# Daytona client for the macOS sandbox (pinned to the version the tooling was written against).
python3 -m pip install --quiet --user 'daytona==2.0.0a13' >/dev/null 2>&1 \
  || python3 -m pip install --quiet --break-system-packages 'daytona==2.0.0a13' >/dev/null 2>&1 \
  && echo "pip: daytona" || echo "pip failed: daytona"

# Staging build settings for the sandbox build (ignored by git).
if [[ -x tools/sandbox/staging-config.sh && -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  tools/sandbox/staging-config.sh >/dev/null 2>&1 && echo "staging config ready" || echo "staging config failed"
fi

for v in DAYTONA_API_KEY SUPABASE_ACCESS_TOKEN; do
  [[ -n "${!v:-}" ]] && echo "$v set" || echo "$v missing"
done
exit 0
