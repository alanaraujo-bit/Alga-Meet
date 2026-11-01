// utilityProcess "alga-e2ee" (docs/decisions/0004-e2ee.md §3.1): hosts the OpenMLS WASM (native/mls) out of
// main and the renderer. Talks only to main over parentPort. argv[2] = path of the wasm-bindgen glue
// (alga_mls.js, which loads alga_mls_bg.wasm from its own directory).
import { createRequire } from 'node:module'
import { createRunner, type Glue, type MlsMessage, type MlsOp } from './rpc'

const port = process.parentPort
const t0 = performance.now()
try {
  const run = createRunner(createRequire(__filename)(process.argv[2] ?? '') as Glue)
  port.on('message', ({ data }: { data: { id: number } & MlsOp }) => {
    let reply: MlsMessage
    try {
      reply = { id: data.id, ok: true, value: run(data) }
    } catch (err) {
      // The WASM layer throws plain strings.
      reply = { id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    port.postMessage(reply)
  })
  port.postMessage({ ready: true, initMs: performance.now() - t0 } satisfies MlsMessage)
} catch (err) {
  port.postMessage({ ready: false, error: String(err) } satisfies MlsMessage)
}
