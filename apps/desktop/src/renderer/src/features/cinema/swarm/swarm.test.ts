import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { memoryCache } from './cache'
import { decode, encode, CHUNK_BYTES } from './protocol'
import { HIGH_WATER, Swarm, type ChannelLike } from './swarm'

/** A ChannelLike over a Node MessageChannel that models bufferedAmount and counts chunk payload bytes sent. */
interface FakeChannel extends ChannelLike { bufferedAmount: number; payload: number; peak: number }
const open: MessagePort[] = []
function link(): [FakeChannel, FakeChannel] {
  const { port1, port2 } = new MessageChannel()
  open.push(port1, port2)
  const end = (port: MessagePort): FakeChannel => {
    const ch: FakeChannel = {
      bufferedAmount: 0, bufferedAmountLowThreshold: 0, onmessage: null, onbufferedamountlow: null, payload: 0, peak: 0,
      send(d: ArrayBuffer) {
        const m = decode(d)
        if (m?.t === 'chunk') ch.payload += m.data.byteLength
        ch.bufferedAmount += d.byteLength
        ch.peak = Math.max(ch.peak, ch.bufferedAmount)
        port.postMessage(d)
        setImmediate(() => {
          const before = ch.bufferedAmount
          ch.bufferedAmount -= d.byteLength
          if (before > ch.bufferedAmountLowThreshold && ch.bufferedAmount <= ch.bufferedAmountLowThreshold) ch.onbufferedamountlow?.(new Event('bufferedamountlow'))
        })
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

/** Init piece (n = 0) + `count` media pieces of 10 s and `size` bytes. */
async function film(count: number, size = 300_000) {
  const bytes = [rand(1_000, 99), ...Array.from({ length: count }, (_, i) => rand(size, i + 1))]
  const index: CinemaPieceMeta[] = await Promise.all(bytes.map(async (b, n) => [n === 0 ? -1 : (n - 1) * 10, n === 0 ? 0 : 10, b.byteLength, await hex(b)] as CinemaPieceMeta))
  return { bytes, index, total: bytes.reduce((s, b) => s + b.byteLength, 0) }
}
const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) => a !== null && Buffer.compare(new Uint8Array(a), b) === 0

const swarms: Swarm[] = []
function host(f: { bytes: Uint8Array[]; index: CinemaPieceMeta[] }, source?: (t: CinemaTrackId, n: number) => Promise<ArrayBuffer | null>) {
  const s = new Swarm({ sessionId: 's', isHost: true, cache: memoryCache(), source: source ?? (async (_t, n) => f.bytes[n]?.slice().buffer ?? null) })
  s.setIndex('v', 0, f.index)
  swarms.push(s)
  return s
}
function friend(f: { index: CinemaPieceMeta[] }) {
  const s = new Swarm({ sessionId: 's', isHost: false, cache: memoryCache(), hostId: 'H' })
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

afterEach(async () => {
  await Promise.all(swarms.splice(0).map((s) => s.close()))
  for (const p of open.splice(0)) p.close()
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
    await vi.waitFor(() => expect(gotA.size + gotB.size).toBe(2 * f.bytes.length), { timeout: 10_000, interval: 20 })
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

  it('bans a peer that sends corrupted bytes for that piece and gets the piece right from another', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = await film(8)
    const h = host(f), a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    // C: a raw peer that claims every piece and answers with flipped bytes
    const [c, toA] = link()
    const asks = new Map<number, number>()
    c.onmessage = (e) => {
      const m = decode(e.data as ArrayBuffer)
      if (m?.t !== 'req') return
      asks.set(m.n, (asks.get(m.n) ?? 0) + 1)
      const bad = f.bytes[m.n]!.slice()
      bad[0] = (bad[0] ?? 0) ^ 0xff
      for (let off = 0; off < bad.length; off += CHUNK_BYTES) {
        c.send(encode({ t: 'chunk', track: 'v', n: m.n, v: m.v, offset: off, total: bad.length, data: bad.subarray(off, off + CHUNK_BYTES) }))
      }
    }
    a.addPeer('C', toA)
    c.send(encode({ t: 'have', track: 'v', bits: new Uint8Array([0xff, 0xff]) }))
    await vi.waitFor(() => expect(got.size).toBe(f.bytes.length), { timeout: 10_000, interval: 20 })
    for (let n = 0; n < f.bytes.length; n++) expect(sameBytes(await a.get('v', n), f.bytes[n]!)).toBe(true)
    expect(asks.size).toBeGreaterThan(0)
    expect([...asks.values()].every((k) => k === 1)).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('hash'))).toBe(true)
  })

  it('treats a piece the host no longer has (source → null) as missing there and fetches it from a peer', async () => {
    const f = await film(8)
    let asked5 = false
    // F: a raw peer holding every piece but n5 until the host turns n5 down
    const [fch, toA] = link()
    const h = host(f, async (_t, n) => {
      if (n !== 5) return f.bytes[n]!.slice().buffer
      asked5 = true
      setTimeout(() => fch.send(encode({ t: 'got', track: 'v', n: 5 })), 5)
      return null
    })
    const a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    const served: number[] = []
    fch.onmessage = (e) => {
      const m = decode(e.data as ArrayBuffer)
      if (m?.t !== 'req') return
      served.push(m.n)
      const b = f.bytes[m.n]!
      fch.send(encode({ t: 'chunk', track: 'v', n: m.n, v: m.v, offset: 0, total: b.length, data: b.subarray(0, CHUNK_BYTES) }))
      if (b.length > CHUNK_BYTES) fch.send(encode({ t: 'chunk', track: 'v', n: m.n, v: m.v, offset: CHUNK_BYTES, total: b.length, data: b.subarray(CHUNK_BYTES) }))
    }
    a.addPeer('F', toA)
    fch.send(encode({ t: 'have', track: 'v', bits: new Uint8Array([0b1101_1111, 0b1]) }))
    await vi.waitFor(() => expect(got.size).toBe(f.bytes.length), { timeout: 10_000, interval: 20 })
    expect(asked5).toBe(true)
    expect(served).toContain(5)
    expect(sameBytes(await a.get('v', 5), f.bytes[5]!)).toBe(true)
  })

  it('drops a cached piece whose index entry is overwritten and fetches the new version', async () => {
    const f = await film(6)
    const h = host(f), a = friend(f)
    const got = count(a)
    connect(h, 'H', a, 'A')
    await vi.waitFor(() => expect(got.size).toBe(f.bytes.length), { timeout: 10_000, interval: 20 })
    const fresh = rand(250_000, 777)
    f.bytes[4] = fresh
    const m: CinemaPieceMeta = [30, 10, fresh.byteLength, await hex(fresh)]
    h.setIndex('v', 4, [m])
    got.clear()
    a.setIndex('v', 4, [m])
    expect(await a.get('v', 4)).toBeNull()
    await vi.waitFor(() => expect(got.has(4)).toBe(true), { timeout: 10_000, interval: 20 })
    expect(sameBytes(await a.get('v', 4), fresh)).toBe(true)
  })

  it('stays within capBytes, evicting pieces more than 10 min behind the playhead first', async () => {
    const f = await film(8)
    f.index.forEach((m, n) => { if (n > 0) { m[0] = (n - 1) * 300; m[1] = 300 } }) // 5 min pieces: n1 0–300 s … n8 2100–2400 s
    const h = host(f)
    const cache = memoryCache()
    const cap = 1_000 + 4 * 300_000
    const a = new Swarm({ sessionId: 's', isHost: false, cache, hostId: 'H', capBytes: cap })
    swarms.push(a)
    a.setIndex('v', 0, f.index)
    a.setTracks(['v'])
    const got = count(a)
    connect(h, 'H', a, 'A')
    await vi.waitFor(() => expect([...got].sort()).toEqual([0, 1, 2, 3, 4]), { timeout: 10_000, interval: 20 })
    a.setPlayhead(1_500) // n1 ends 1200 s behind, n2 900 s, n3 600 s, n4 300 s
    await vi.waitFor(() => expect(got.has(6) && got.has(7)).toBe(true), { timeout: 10_000, interval: 20 })
    await new Promise((r) => setTimeout(r, 30))
    expect(await a.get('v', 1)).toBeNull()
    expect(await a.get('v', 2)).toBeNull()
    for (const n of [0, 3, 4, 6, 7]) expect(sameBytes(await a.get('v', n), f.bytes[n]!)).toBe(true)
    expect(cache.bytes()).toBeLessThanOrEqual(cap)
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
    await new Promise((r) => setTimeout(r, 20))
    await cache.put('v:1', new ArrayBuffer(4))
    await a.close()
    expect(cache.bytes()).toBe(0)
  })
})
