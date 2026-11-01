#!/usr/bin/env sh
# Release WASM + Node glue into native/mls/pkg (alga_mls.js + alga_mls_bg.wasm), loaded by apps/desktop/src/main/mls
# and apps/server/src/e2ee.ts. pkg/ is committed (no CI): this also rewrites pkg/BUILD-INFO.json and
# pkg/THIRD-PARTY-NOTICES.txt, and `npm run verify:mls` (electron-builder beforePack) refuses a stale pkg.
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.130 --locked
set -e
cd "$(dirname "$0")"
# Panic locations would embed the builder's cargo home (C:\Users\<name>\.cargo\...) in the committed .wasm.
home=${CARGO_HOME:-$HOME/.cargo}
if command -v cygpath >/dev/null 2>&1; then home=$(cygpath -w "$home"); fi
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$home=/cargo"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target nodejs --out-dir pkg target/wasm32-unknown-unknown/release/alga_mls.wasm
node notices.cjs
node build-info.cjs write
