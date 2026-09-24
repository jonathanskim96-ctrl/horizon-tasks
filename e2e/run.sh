#!/usr/bin/env bash
# Builds the app against a fake Supabase origin, serves it, runs the browser suite.
# Playwright isn't a project dependency (keeps CI lean); this installs it on the fly.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules/playwright ] || npm i --no-save playwright@1 >/dev/null
if [ -z "${CHROMIUM_PATH:-}" ] && [ -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ]; then
  export CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
fi
VITE_SUPABASE_URL=http://mock.supabase.local VITE_SUPABASE_ANON_KEY=sb_publishable_test npx vite build >/dev/null
npx vite preview --port 5198 --strictPort >/dev/null 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW' EXIT
sleep 2
node e2e/suite.mjs
# App-update flow: two builds (A → B) served by a tiny static server.
UPD=$(mktemp -d)
for v in a b; do
  VITE_BUILD_ID=$(printf "$v%.0s" 1 2 3 4 5 6 7) VITE_SUPABASE_URL=http://mock.supabase.local VITE_SUPABASE_ANON_KEY=sb_publishable_test \
    npx vite build --outDir "$UPD/$v" >/dev/null
done
node e2e/update.mjs "$UPD/a" "$UPD/b"
rm -rf "$UPD"
