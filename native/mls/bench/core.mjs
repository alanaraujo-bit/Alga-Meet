// MLS cost per call event, same code in plain Node (node.mjs) and inside an Electron utilityProcess (electron.mjs).
// Room of n-1 members, then `reps` times: a newcomer joins (room -> n) and is removed again (n -> n-1).
// Committer = leaf 0, proposals come from the DS (external sender), as in docs/decisions/0004-e2ee.md §3.3.
const enc = new TextEncoder()
const GID = enc.encode('call:bench')
const DS_ID = enc.encode('alga-ds')
const LABEL = 'Alga Media v1'

const ms = (fn) => {
  const t = performance.now()
  const v = fn()
  return [performance.now() - t, v]
}
const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
export const stats = (xs) => ({ p50: pct(xs, 50), p95: pct(xs, 95), max: pct(xs, 100), n: xs.length })

function commitAll(c) {
  const out = { commit: c.commit, welcome: c.welcome }
  c.free()
  return out
}

export function bench(mls, { sizes = [2, 10, 25, 99], reps = 20 } = {}) {
  let seq = 0
  const fresh = () => new mls.Client(enc.encode(`user${seq++}:device`))
  const ds = new mls.Client(DS_ID)
  const results = []
  for (const n of sizes) {
    const room = [fresh()]
    room[0].create_group(GID, ds.signature_public_key(), DS_ID)
    const joiners = Array.from({ length: n - 2 }, fresh)
    if (joiners.length) {
      for (const j of joiners) room[0].process(ds.external_propose_add(GID, room[0].epoch(), j.key_package()))
      const c = commitAll(room[0].commit_pending())
      room[0].process(c.commit)
      for (const j of joiners) j.process_welcome(c.welcome)
      room.push(...joiners)
    }
    const s = { kp: [], proposal: [], commit: [], welcome: [], commitProc: [], removeCommit: [], removeProc: [] }
    const bytes = {}
    for (let r = 0; r < reps; r++) {
      const x = fresh()
      const [kpMs, kp] = ms(() => x.key_package())
      s.kp.push(kpMs)
      const add = ds.external_propose_add(GID, room[0].epoch(), kp)
      for (const m of room) s.proposal.push(ms(() => m.process(add))[0])
      const [cMs, c] = ms(() => commitAll(room[0].commit_pending()))
      s.commit.push(cMs)
      room[0].process(c.commit) // DS echo
      for (const m of room.slice(1)) s.commitProc.push(ms(() => m.process(c.commit))[0])
      s.welcome.push(ms(() => x.process_welcome(c.welcome))[0])
      const key = room[0].export_secret(LABEL, enc.encode('user0\0device'), 32).join()
      for (const m of [...room, x]) if (m.export_secret(LABEL, enc.encode('user0\0device'), 32).join() !== key) throw new Error('exporter mismatch')
      Object.assign(bytes, { keyPackage: kp.length, commit: c.commit.length, welcome: c.welcome.length, state: x.save_state().length })

      const remove = ds.external_propose_remove(GID, room[0].epoch(), x.own_leaf_index())
      for (const m of [...room, x]) m.process(remove)
      const [rcMs, rc] = ms(() => commitAll(room[0].commit_pending()))
      s.removeCommit.push(rcMs)
      bytes.removeCommit = rc.commit.length
      room[0].process(rc.commit)
      for (const m of room.slice(1)) s.removeProc.push(ms(() => m.process(rc.commit))[0])
      if (x.process(rc.commit) !== 'removed') throw new Error('removal not seen')
      x.free()
    }
    results.push({ n, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, stats(v)])), bytes })
    for (const m of room) m.free()
  }
  ds.free()
  return results
}
