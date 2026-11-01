// Plain Node: cold init of the wasm-bindgen glue + bench(). `node native/mls/bench/node.mjs [reps]`.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { bench } from './core.mjs'

const wasm = readFileSync(new URL('../pkg/alga_mls_bg.wasm', import.meta.url))
const t0 = performance.now()
const mls = createRequire(import.meta.url)('../pkg/alga_mls.js')
const initMs = performance.now() - t0
const t1 = performance.now()
new mls.Client(new TextEncoder().encode('first')).free()
const firstClientMs = performance.now() - t1

const results = bench(mls, { reps: Number(process.argv[2] ?? 20) })
const mem = process.memoryUsage()
console.log(
  JSON.stringify(
    {
      runtime: `node ${process.versions.node}`,
      wasmBytes: wasm.length,
      wasmGzipBytes: gzipSync(wasm, { level: 9 }).length,
      initMs,
      firstClientMs,
      rssMB: mem.rss / 2 ** 20,
      arrayBuffersMB: mem.arrayBuffers / 2 ** 20,
      results,
    },
    null,
    1,
  ),
)
