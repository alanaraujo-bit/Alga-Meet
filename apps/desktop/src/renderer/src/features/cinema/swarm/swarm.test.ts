import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Assembler } from './assembler'
import { memoryCache, type PieceCache } from './cache'
import { CHUNK_BYTES, bitsOf, decode, encode, setOf, verOf, type WireMsg } from './protocol'
import { HIGH_WATER, Swarm, type ChannelLike } from './swarm'

/**
 * A ChannelLike over a Node MessageChannel. It models bufferedAmount, counts chunk payload bytes, logs what is sent,
 * and can hold outgoing messages (an uploader stuck on a slow link) until release().
 */
interface FakeChannel extends ChannelLike { bufferedAmount: number; payload: number; peak: number; log: WireMsg[]; hold: boolean; release(): void }
const open: MessagePort[] = []
function link(): [FakeChannel, FakeChannel] {
  const { port1, port2 } = new MessageChannel()
  open.push(port1, port2)
  const end = (port: MessagePort): FakeChannel => {
    const held: ArrayBuffer[] = []
    const deliver = (d: ArrayBuffer) => {
      port.postMessage(d)
      setImmediate(() => {
        const before = ch.bufferedAmount
        ch.bufferedAmount -= d.byteLength
        if (before > ch.bufferedAmountLowThreshold && ch.bufferedAmount <= ch.bufferedAmountLowThreshold) ch.onbufferedamountlow?.(new Event('bufferedamountlow'))
      })
    }
    const ch: FakeChannel = {
      bufferedAmount: 0, bufferedAmountLowThreshold: 0, onmessage: null, onbufferedamountlow: null, payload: 0, peak: 0, log: [], hold: false,
      send(d: ArrayBuffer) {
        const m = decode(d)
        if (m) ch.log.push(m)
        if (m?.t === 'chunk') ch.payload += m.data.byteLength
        ch.bufferedAmount += d.byteLength
        ch.peak = Math.max(ch.peak, ch.bufferedAmount)
        if (ch.hold) held.push(d)
        else deliver(d)
      },
      release() {
        ch.hold = false
        for (const d of held.splice(0)) deliver(d)
      },
      close() { port.close() },
    }
    port.onmessage = (e) => ch.onmessage?.(e)
    return ch
  }
  return [end(port1), end(port2)]
}

const hex = async (b: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('')
const rand = (n: number, seed: number) => { let s = seed; return Uint8Array.from({ length: n }, () => (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Real-time polling (vi.waitFor would advance fake timers). */
async function until(cond: () => boolean, ms = 5_000) {
  const end = performance.now() + ms
  while (!cond()) {
    if (performance.now() > end) throw new Error('until: timed out')
    await sleep(5)
  }
}

type Film = { bytes: Uint8Array<ArrayBuffer>[]; index: CinemaPieceMeta[]; total: number }
/** Init piece (n = 0) + `count` media pieces of 10 s and `size` bytes. */
async function film(count: number, size = 300_000): Promise<Film> {
  const bytes = [rand(1_000, 99), ...Array.from({ length: count }, (_, i) => rand(size, i + 1))]
  const index: CinemaPieceMeta[] = await Promise.all(bytes.map(async (b, n) => [n === 0 ? -1 : (n - 1) * 10, n === 0 ? 0 : 10, b.byteLength, await hex(b)] as CinemaPieceMeta))
  return { bytes, index, total: bytes.reduce((s, b) => s + b.byteLength, 0) }
}
const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) => a !== null && Buffer.compare(new Uint8Array(a), b) === 0
const haveAll = (f: Film): WireMsg => ({ t: 'have', track: 'v', bits: bitsOf(f.bytes.keys()) })

const swarms: Swarm[] = []
function host(f: Film, source?: (t: CinemaTrackId, n: number) => Promise<ArrayBuffer | null>) {
  const s = new Swarm({ sessionId: 's', isHost: true, cache: memoryCache(), source: source ?? (async (_t, n) => f.bytes[n]?.slice().buffer ?? null) })
  s.setIndex('v', 0, f.index)
  swarms.push(s)
  return s
}
function friend(f: Film, opts: { cache?: PieceCache; capBytes?: number } = {}) {
  const s = new Swarm({ sessionId: 's', isHost: false, cache: opts.cache ?? memoryCache(), hostId: 'H', capBytes: opts.capBytes })
  s.setIndex('v', 0, f.index)
  s.setTracks(['v'])
  swarms.push(s)
  return s
}
function connect(a: Swarm, aId: string, b: Swarm, bId: string) {
  const [x, y] = link()
  a.addPeer(bId, x)
  b.addPeer(aId, y)
  return [x, y] as const
}
const count = (s: Swarm) => { const got = new Set<number>(); s.onPiece((_t, n) => got.add(n)); return got }
/** Same cache, slow writes: a store stays in progress for `ms`. */
const slowCache = (inner: PieceCache, ms: number, onPut?: () => void): PieceCache => ({ ...inner, put: async (k, b) => { onPut?.(); await sleep(ms); return inner.put(k, b) } })

/** A hand-driven peer attached to `s` as `id`: `ch` is its own end, `side` the swarm's end (its log = what s sent). */
function raw(s: Swarm, id: string, f: Film, onReq?: (m: Extract<WireMsg, { t: 'req' }>, r: Raw) => void) {
  const [ch, side] = link()
  const r = {
    ch, side, reqs: [] as Extract<WireMsg, { t: 'req' }>[], cancels: [] as number[], msgs: [] as WireMsg[], done: [] as number[],
    serve(n: number, v: number, o: { chunks?: number; bytes?: Uint8Array } = {}) {
      const b = o.bytes ?? f.bytes[n]!
      for (let off = 0, i = 0; off < b.length && i < (o.chunks ?? Infinity); off += CHUNK_BYTES, i++) {
        ch.send(encode({ t: 'chunk', track: 'v', n, v, offset: off, total: b.length, data: b.subarray(off, off + CHUNK_BYTES) }))
      }
    },
  }
  ch.onmessage = (e) => {
    const m = decode(e.data as ArrayBuffer)
    if (!m) return
    r.msgs.push(m)
    if (m.t === 'req') { r.reqs.push(m); onReq?.(m, r) }
    if (m.t === 'cancel') r.cancels.push(m.n)
    if (m.t === 'chunk' && m.offset + m.data.byteLength === m.total) r.done.push(m.n)
  }
  s.addPeer(id, side)
  return r
}
type Raw = ReturnType<typeof raw>
const fakeClock = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }) // timers the swarm uses; I/O stays real

afterEach(async () => {
  await Promise.all(swarms.splice(0).map((s) => s.close()))
  for (const p of open.splice(0)) p.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Swarm', () => {
  it('RTCDataChannel satisfies ChannelLike', () => {
    expectTypeOf<RTCDataChannel>().toExtend<ChannelLike>()
  })

  it('3 peers: both friends end with every piece and the host uploads ≤ 1.5× the film (super-seed)', async () => {
    const f = await film(20)
    const h = host(f), a = friend(f), b = friend(f)
    const gotA = count(a), gotB = count(b)
    const [hA] = connect(h, 'H', a, 'A')
    const [hB] = connect(h, 'H', b, 'B')
    connect(a, 'A', b, 'B')
    await until(() => gotA.size + gotB.size === 2 * f.bytes.length)
    for (const s of [a, b]) for (let n = 0; n < f.bytes.length; n++) expect(sameBytes(await s.get('v', n), f.bytes[n]!)).toBe(true)
    expect(sameBytes(await a.init('v'), f.bytes[0]!)).toBe(true)
    const ratio = (hA.payload + hB.payload) / f.total
    console.info(`[super-seed] host sent ${hA.payload + hB.payload} B for a ${f.total} B film: ${ratio.toFixed(2)}×`)
    expect(ratio).toBeLessThanOrEqual(1.5)
    expect(Math.max(hA.peak, hB.peak)).toBeLessThanOrEqual(HIGH_WATER + 224 * 1024 + 1024) // one chunk past the mark, plus control messages
    expect(a.aheadS('v')).toBe(200)
    expect(a.stats().fromHostPct + a.stats().fromPeersPct).toBeCloseTo(100)
    expect(a.stats().peers).toBe(2)
  })

  it('host + X + Y with X and Y not connected: both get the whole film in time, host uploads ≤ 2.1×', async () => {
    fakeClock()
    const f = await film(20)
    const h = host(f), x = friend(f), y = friend(f)
    const t0 = Date.now()
    const arrived = new Map<string, number>()
    for (const [s, id] of [[x, 'X'], [y, 'Y']] as const) s.onPiece((_t, n) => arrived.set(`${id}:${n}`, Date.now() - t0))
    const [hx] = connect(h, 'H', x, 'X')
    const [hy] = connect(h, 'H', y, 'Y')
    for (let i = 0; i < 10 && arrived.size < 2 * f.bytes.length; i++) {
      await sleep(100)
      vi.advanceTimersByTime(6_000) // the 1 s tick lets refusals expire; the host serves the repeated request
    }
    await until(() => arrived.size === 2 * f.bytes.length)
    const ratio = (hx.payload + hy.payload) / f.total
    console.info(`[unreachable] host sent ${ratio.toFixed(2)}× the film`)
    expect(ratio).toBeLessThanOrEqual(2.1)
    // playing from 0 at 1×, each piece is there before the playhead reaches its start (prefetch, not the critical window)
    for (const [k, at] of arrived) expect(at, k).toBeLessThanOrEqual(Math.max(0, f.index[Number(k.slice(2))]![0]) * 1000)
  })

  it('bans a peer that sends corrupted bytes for that piece, backs off from it, and gets the piece right from another', async () => {
    let c: Raw | undefined
    const reqsToC = () => c!.side.log.filter((m) => m.t === 'req').length
    const atBan: number[] = [] // requests sent to C so far, at each ban
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { atBan.push(reqsToC()) })
    const f = await film(12)
    const h = host(f), a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    c = raw(a, 'C', f, (m, r) => {
      const bad = f.bytes[m.n]!.slice()
      bad[0] = (bad[0] ?? 0) ^ 0xff
      r.serve(m.n, m.v, { bytes: bad })
    })
    c.ch.send(encode(haveAll(f)))
    await until(() => got.size === f.bytes.length)
    for (let n = 0; n < f.bytes.length; n++) expect(sameBytes(await a.get('v', n), f.bytes[n]!)).toBe(true)
    const asked = c.reqs.map((r) => r.n)
    expect(new Set(asked).size).toBe(asked.length) // never asked twice for the same piece
    expect(warn.mock.calls.some((w) => String(w[0]).includes('hash'))).toBe(true)
    expect(atBan.length).toBeGreaterThanOrEqual(3)
    expect(reqsToC()).toBe(atBan[2]) // 3 bans → 60 s back-off: nothing more is asked of C
    expect(reqsToC()).toBeLessThan(f.bytes.length - 4) // so most prefetch came from the host
  })

  it('treats a piece the host no longer has (source → null) as missing there and fetches it from a peer', async () => {
    const f = await film(8)
    let asked5 = false
    let F: Raw | undefined
    const h = host(f, async (_t, n) => {
      if (n !== 5) return f.bytes[n]!.slice().buffer
      asked5 = true
      setTimeout(() => F!.ch.send(encode({ t: 'got', track: 'v', n: 5 })), 5)
      return null
    })
    const a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    // F holds every piece but n5 until the host turns n5 down
    F = raw(a, 'F', f, (m, r) => r.serve(m.n, m.v))
    F.ch.send(encode({ t: 'have', track: 'v', bits: new Uint8Array([0b1101_1111, 0b1]) }))
    await until(() => got.size === f.bytes.length)
    expect(asked5).toBe(true)
    expect(F.reqs.map((r) => r.n)).toContain(5)
    expect(sameBytes(await a.get('v', 5), f.bytes[5]!)).toBe(true)
  })

  it('drops a cached piece whose index entry is overwritten and fetches the new version', async () => {
    const f = await film(6)
    const h = host(f), a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    await until(() => got.size === f.bytes.length)
    const fresh = rand(250_000, 777)
    f.bytes[4] = fresh
    const m: CinemaPieceMeta = [30, 10, fresh.byteLength, await hex(fresh)]
    h.setIndex('v', 4, [m])
    got.clear()
    a.setIndex('v', 4, [m])
    expect(await a.get('v', 4)).toBeNull()
    await until(() => got.has(4))
    expect(sameBytes(await a.get('v', 4), fresh)).toBe(true)
  })

  it('ignores chunks once a piece is whole: a stray chunk opens no partial, a full re-send never unstores it', async () => {
    const f = await film(2, 600_000)
    const a = friend(f, { cache: slowCache(memoryCache(), 30) })
    const got = count(a)
    const p = raw(a, 'P', f, (m, r) => {
      r.serve(m.n, m.v)
      r.serve(m.n, m.v)
      r.serve(m.n, m.v, { chunks: 1 })
    })
    p.ch.send(encode(haveAll(f)))
    await until(() => got.size === f.bytes.length)
    await sleep(150)
    for (let n = 0; n < f.bytes.length; n++) expect(sameBytes(await a.get('v', n), f.bytes[n]!)).toBe(true)
    expect((a as unknown as { asm: Assembler }).asm.pending()).toBe(0)
  })

  it('a failed cache write tells the uploader (cancel), and the piece is fetched again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = await film(4)
    const inner = memoryCache()
    let failed = false
    const flaky: PieceCache = { ...inner, put: async (k, b) => { if (k === 'v:2' && !failed) { failed = true; throw new DOMException('full', 'QuotaExceededError') } return inner.put(k, b) } }
    const h = host(f), a = friend(f, { cache: flaky })
    const got = count(a)
    const [, aSide] = connect(h, 'H', a, 'A')
    await until(() => got.has(2))
    expect(failed).toBe(true)
    expect(aSide.log.some((m) => m.t === 'cancel' && m.n === 2)).toBe(true)
    expect(sameBytes(await a.get('v', 2), f.bytes[2]!)).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('after a seek, preempts the farthest prefetch at once and the critical piece lands before the queued prefetch', async () => {
    const f = await film(20)
    const a = friend(f)
    const got = count(a)
    const p = raw(a, 'P', f, (m, r) => { if (m.urgent) r.serve(m.n, m.v) }) // answers critical requests, sits on prefetch
    p.ch.send(encode(haveAll(f)))
    await until(() => got.has(3) && p.reqs.filter((r) => !r.urgent).length === 3)
    expect(p.reqs.filter((r) => !r.urgent).map((r) => r.n)).toEqual([4, 5, 6])
    a.setPlayhead(195) // only n20 (190–200 s) is critical now
    await Promise.resolve()
    expect(p.side.log.slice(-2)).toEqual([{ t: 'cancel', track: 'v', n: 6 }, { t: 'req', track: 'v', n: 20, v: verOf(f.index[20]![3]), urgent: true }])
    await until(() => got.has(20))
    expect(got.has(4) || got.has(5)).toBe(false)
  })

  it('the uploader serves an urgent request before queued prefetch', async () => {
    const f = await film(20, 600_000)
    const h = host(f)
    const r = raw(h, 'R', f)
    r.side.hold = true // a slow link: the host's sends pile up
    const req = (n: number, urgent: boolean) => r.ch.send(encode({ t: 'req', track: 'v', n, v: verOf(f.index[n]![3]), urgent }))
    req(4, false)
    req(5, false)
    req(6, false)
    await sleep(30)
    req(20, true)
    await sleep(30)
    r.side.release()
    await until(() => r.done.length === 4)
    expect(r.done).toEqual([4, 20, 5, 6])
  })

  it('moves a critical download that will miss its deadline to another holder, long before the 15 s timeout', async () => {
    fakeClock()
    const f = await film(8, 600_000)
    const a = friend(f)
    a.setPlayhead(12) // n2 (10–20 s) is playing: deadline 0; n3 (20–30 s) has 8 s
    const got = count(a)
    const s = raw(a, 'S', f, (m, r) => r.serve(m.n, m.v, { chunks: 1 })) // one chunk, then silence
    s.ch.send(encode(haveAll(f)))
    await until(() => s.reqs.filter((r) => r.n === 2 || r.n === 3).length === 2)
    connect(host(f), 'H', a, 'A')
    await sleep(100)
    expect(got.has(2)).toBe(false)
    vi.advanceTimersByTime(3_000)
    await until(() => got.has(2))
    expect(s.cancels).toContain(2)
    expect(got.has(3)).toBe(false) // at its rate so far n3 still makes its 8 s: it stays with S
  })

  it('times out a silent prefetch after 15 s, cancels it and fetches the piece elsewhere', async () => {
    fakeClock()
    const f = await film(8)
    const a = friend(f)
    const got = count(a)
    const s = raw(a, 'S', f) // claims everything, never answers
    s.ch.send(encode(haveAll(f)))
    await until(() => s.reqs.length === 3)
    connect(host(f), 'H', a, 'A')
    await sleep(100)
    vi.advanceTimersByTime(3_000) // critical pieces at S are late (no bytes): moved to H
    await until(() => [0, 1, 2, 3].every((n) => got.has(n)))
    await sleep(50)
    expect(s.reqs.some((r) => !r.urgent)).toBe(true) // prefetch goes to the friend first
    vi.advanceTimersByTime(12_000)
    await sleep(100)
    expect(got.has(4)).toBe(false)
    vi.advanceTimersByTime(4_000)
    await until(() => got.size === f.bytes.length)
    expect(s.cancels).toEqual(expect.arrayContaining(s.reqs.filter((r) => !r.urgent).map((r) => r.n)))
  })

  it('stays within capBytes, evicting pieces more than 10 min behind first, and tells peers what it dropped', async () => {
    const f = await film(8)
    f.index.forEach((m, n) => { if (n > 0) { m[0] = (n - 1) * 300; m[1] = 300 } }) // 5 min pieces: n1 0–300 s … n8 2100–2400 s
    const h = host(f)
    const cache = memoryCache()
    const cap = 1_000 + 4 * 300_000
    const a = friend(f, { cache, capBytes: cap })
    const got = count(a)
    connect(h, 'H', a, 'A')
    const b = raw(a, 'B', f)
    await until(() => [0, 1, 2, 3, 4].every((n) => got.has(n)) && got.size === 5)
    a.setPlayhead(1_500) // n1 ends 1200 s behind, n2 900 s, n3 600 s, n4 300 s
    await until(() => got.has(6) && got.has(7))
    await sleep(30)
    expect(await a.get('v', 1)).toBeNull()
    expect(await a.get('v', 2)).toBeNull()
    for (const n of [0, 3, 4, 6, 7]) expect(sameBytes(await a.get('v', n), f.bytes[n]!)).toBe(true)
    expect(cache.bytes()).toBeLessThanOrEqual(cap)
    const seen = new Set<number>() // what B believes A holds, from A's have/got messages
    for (const m of b.msgs) {
      if (m.t === 'have') { seen.clear(); for (const n of setOf(m.bits)) seen.add(n) }
      if (m.t === 'got') seen.add(m.n)
    }
    expect([...seen].sort()).toEqual([0, 3, 4, 6, 7])
  })

  it('close() waits for a store in progress before clearing the cache', async () => {
    const f = await film(1)
    const inner = memoryCache()
    let putting = false
    const a = friend(f, { cache: slowCache(inner, 30, () => { putting = true }) })
    connect(host(f), 'H', a, 'A')
    await until(() => putting)
    await a.close()
    expect(inner.bytes()).toBe(0)
    await sleep(60)
    expect(inner.bytes()).toBe(0)
  })

  it('ignores text and malformed messages; close() empties the cache', async () => {
    const f = await film(2)
    const cache = memoryCache()
    const a = new Swarm({ sessionId: 's', isHost: false, cache, hostId: 'H' })
    const [, y] = link()
    a.addPeer('X', y)
    y.onmessage?.(new MessageEvent('message', { data: 'hello' }))
    y.onmessage?.(new MessageEvent('message', { data: new Uint8Array([6, 0, 0, 0]).buffer }))
    a.setIndex('v', 0, f.index)
    await sleep(20)
    await cache.put('v:1', new ArrayBuffer(4))
    await a.close()
    expect(cache.bytes()).toBe(0)
  })
})
