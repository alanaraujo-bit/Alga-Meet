// bench() inside an Electron utilityProcess (forked by electron.mjs). argv: glue path, reps.
import { createRequire } from 'node:module'
import { bench } from './core.mjs'

const t0 = performance.now()
const mls = createRequire(import.meta.url)(process.argv[2])
const initMs = performance.now() - t0
const results = bench(mls, { reps: Number(process.argv[3] ?? 20) })
process.parentPort.postMessage({ initMs, results })
