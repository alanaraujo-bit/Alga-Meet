#!/usr/bin/env sh
# Release WASM + Node glue into native/mls/pkg (alga_mls.js + alga_mls_bg.wasm), loaded by apps/desktop/src/main/mls.
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.130 --locked
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target nodejs --out-dir pkg target/wasm32-unknown-unknown/release/alga_mls.wasm
