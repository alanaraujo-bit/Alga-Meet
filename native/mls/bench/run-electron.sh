#!/usr/bin/env sh
# Bundle the Electron harness with the app's real mls/host.ts + mls/worker.ts and run it (REPS=20 by default).
# Needs native/mls/pkg (native/mls/build.sh). Output: native/mls/target/electron-bench/result.json.
set -e
cd "$(dirname "$0")/../../.."
out=native/mls/target/electron-bench
esbuild=node_modules/.bin/esbuild
$esbuild native/mls/bench/electron.mjs --bundle --platform=node --format=cjs --external:electron --log-level=warning --outfile=$out/main.js
$esbuild apps/desktop/src/main/mls/worker.ts --bundle --platform=node --format=cjs --external:electron --log-level=warning --outfile=$out/mls-worker.js
node_modules/electron/dist/electron.exe $out/main.js || echo "electron exited $?"
cat $out/result.json
