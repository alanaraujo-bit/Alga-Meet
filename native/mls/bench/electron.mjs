// Electron 45 harness. Bundled by run-electron.sh (esbuild) next to the real mls-worker.js, then run with electron.
// 1. The app's own host.ts + worker.ts: cold start, RPC round trip, a device joining a 99-member room over RPC,
//    worker memory. 2. bench() inside a utilityProcess (same V8/Node as production).
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'
import { mls } from '../../../apps/desktop/src/main/mls/host'
import { stats } from './core.mjs'

const root = join(__dirname, '..', '..', '..', '..') // native/mls/target/electron-bench -> repo
const reps = Number(process.env.REPS ?? 20)
app.setPath('userData', join(__dirname, 'userData'))
app.getAppPath = () => join(root, 'apps', 'desktop') // host.ts resolves the dev glue from the app path
app.disableHardwareAcceleration()
setTimeout(() => app.exit(2), 15 * 60_000) // never outlive a hung run

const enc = new TextEncoder()
const LABEL = 'Alga Media v1'
const CTX = enc.encode('user0\0device')
const GID = enc.encode('call:electron')
const DS_ID = enc.encode('alga-ds')
const timed = async (fn) => {
  const t = performance.now()
  const v = await fn()
  return [performance.now() - t, v]
}
const workerMem = () =>
  app
    .getAppMetrics()
    .filter((m) => m.type === 'Utility' && m.name === 'alga-e2ee')
    .map((m) => ({ workingSetMB: m.memory.workingSetSize / 1024, privateMB: m.memory.privateBytes / 1024 }))[0]

async function realWorker() {
  const call = (handle, method, ...args) => mls({ op: 'call', handle, method, args })
  const [coldStartMs, dut] = await timed(() => mls({ op: 'new', bytes: enc.encode('dut:device') }))
  const rt = []
  for (let i = 0; i < 200; i++) rt.push((await timed(() => call(dut, 'signature_public_key')))[0])
  const memIdle = workerMem()

  // The rest of the room lives in this process (local glue); only the device under test is in the worker.
  const local = createRequire(__filename)(join(root, 'native', 'mls', 'pkg', 'alga_mls.js'))
  let seq = 0
  const fresh = () => new local.Client(enc.encode(`user${seq++}:device`))
  const ds = new local.Client(DS_ID)
  const room = [fresh()]
  room[0].create_group(GID, ds.signature_public_key(), DS_ID)
  const others = Array.from({ length: 97 }, fresh)
  for (const j of others) room[0].process(ds.external_propose_add(GID, room[0].epoch(), j.key_package()))
  const boot = room[0].commit_pending()
  room[0].process(boot.commit)
  for (const j of others) j.process_welcome(boot.welcome)
  room.push(...others)
  const everyone = async (msg, dutToo = true) => {
    for (const m of room) m.process(msg)
    if (dutToo) return (await timed(() => call(dut, 'process', msg)))[0]
  }
  const commitLocally = async () => {
    const c = room[0].commit_pending()
    const out = { commit: c.commit, welcome: c.welcome }
    c.free()
    return out
  }

  const s = { kp: [], welcome: [], proposal: [], commitProc: [], removeProc: [] }
  let memJoined
  for (let r = 0; r < reps; r++) {
    // Device joins: room 98 -> 99.
    const [kpMs, kp] = await timed(() => call(dut, 'key_package'))
    s.kp.push(kpMs)
    await everyone(ds.external_propose_add(GID, room[0].epoch(), kp), false)
    const j = await commitLocally()
    await everyone(j.commit, false)
    s.welcome.push((await timed(() => call(dut, 'process_welcome', j.welcome)))[0])
    const mine = await call(dut, 'export_secret', LABEL, CTX, 32)
    if (mine.join() !== room[0].export_secret(LABEL, CTX, 32).join()) throw new Error('exporter mismatch')
    memJoined = workerMem()

    // Someone else joins (99 -> 100) and leaves again: the device processes both commits.
    const y = fresh()
    s.proposal.push(await everyone(ds.external_propose_add(GID, room[0].epoch(), y.key_package())))
    const a = await commitLocally()
    s.commitProc.push(await everyone(a.commit))
    y.process_welcome(a.welcome)
    await everyone(ds.external_propose_remove(GID, room[0].epoch(), y.own_leaf_index()))
    s.removeProc.push(await everyone((await commitLocally()).commit))
    y.free()

    // Device leaves (99 -> 98) so the next round joins again.
    await everyone(ds.external_propose_remove(GID, room[0].epoch(), await call(dut, 'own_leaf_index')))
    const out = await commitLocally()
    await everyone(out.commit, false)
    if ((await call(dut, 'process', out.commit)) !== 'removed') throw new Error('device not removed')
  }
  return {
    coldStartMs,
    rpcRoundTrip: stats(rt),
    memIdle,
    memJoined99: memJoined,
    n99: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, stats(v)])),
  }
}

function utilityBench() {
  return new Promise((resolve, reject) => {
    const glue = join(root, 'native', 'mls', 'pkg', 'alga_mls.js')
    const child = utilityProcess.fork(join(root, 'native', 'mls', 'bench', 'utility.mjs'), [glue, String(reps)])
    child.once('message', resolve)
    child.once('exit', (code) => reject(new Error(`utility bench exited ${code}`)))
  })
}

app.whenReady().then(async () => {
  try {
    const out = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }
    out.realWorker = await realWorker()
    out.utility = await utilityBench()
    writeFileSync(join(__dirname, 'result.json'), JSON.stringify(out, null, 1))
    app.exit(0)
  } catch (err) {
    writeFileSync(join(__dirname, 'result.json'), JSON.stringify({ error: String(err?.stack ?? err) }))
    app.exit(1)
  }
})
