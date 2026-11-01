#!/usr/bin/env node
// Userspace UDP impairment proxy (Windows has no tc/netem). Sits between WebRTC clients and an ICE-lite SFU:
//
//   client --> listen (e.g. 127.0.0.2:7892) --> [up link]   --> per-client upstream socket --> SFU (127.0.0.1:7892)
//   client <-- listen                       <-- [down link] <-- per-client upstream socket <-- SFU
//
// Every client address gets its own upstream socket (the SFU answers the address it observed, so each client
// keeps a distinct 5-tuple) and its own up/down link state: Gilbert-Elliott loss, delay + jitter (no
// reordering), token-bucket bandwidth cap with a drop-tail queue, and a hard outage switch.
//
//   node scripts/netem/udp-impair.mjs --listen=127.0.0.2:7892 --target=127.0.0.1:7892 --up=loss=5,delay=25 --down=delay=25
//   node scripts/netem/udp-impair.mjs --selftest
//
// Windows: a UDP socket bound to one local IP only reaches that same IP, so listen on an address the clients
// bind to (WebRTC: a LAN IP) and give the SFU another one (--upstream=<SFU IP>); see apps/desktop/scripts/media-net.mjs.
//
// Profile keys: loss (%), burst (mean lost packets per loss burst, 1 = independent), delay (ms), jitter (± ms,
// uniform), rate (kbit/s, 0 = unlimited), queue (ms of backlog before drop-tail), outage (1 = drop everything).
//
// Timing: Node timers on Windows tick at 15.6 ms, which would itself be jitter. Packets due within 20 ms are
// released by a setImmediate spin (sub-ms; costs one core only while packets are in flight); the selftest
// measures the added-delay error.
import dgram from 'node:dgram'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PROFILE = { loss: 0, burst: 1, delay: 0, jitter: 0, rate: 0, queue: 300, outage: false }
const now = () => Number(process.hrtime.bigint()) / 1e6

/** Small seeded PRNG (mulberry32) so impairment runs are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function parseProfile(text = '') {
  const p = {}
  for (const kv of text.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=')
    if (!(k in DEFAULT_PROFILE)) throw new Error(`unknown profile key: ${k}`)
    p[k] = k === 'outage' ? v === '1' || v === 'true' : Number(v)
  }
  return p
}

/** One direction of one client's access link. */
export class Link {
  constructor(profile, random, send) {
    this.profile = profile // shared object: set() on the proxy changes every link at once
    this.random = random
    this.send = send
    this.bad = false // Gilbert-Elliott state
    this.busyUntil = 0 // token bucket: when the link finishes serializing what it already accepted
    this.lastDue = 0
    this.q = []
    this.head = 0
    this.stats = { in: 0, sent: 0, lost: 0, outage: 0, queueDrop: 0, bytesIn: 0, bytesSent: 0 }
  }

  /** Returns the departure time (ms, hrtime clock) or null if dropped. Pure given `random`/`t`: used by the selftest. */
  admit(bytes, t) {
    const p = this.profile
    this.stats.in++
    this.stats.bytesIn += bytes
    if (p.outage) return this.stats.outage++, null
    if (p.loss > 0) {
      const loss = Math.min(0.99, p.loss / 100)
      if (p.burst <= 1) this.bad = this.random() < loss // independent (netem 'loss random')
      else {
        const r = 1 / p.burst // bad -> good: mean burst length = 1/r
        const g = (loss * r) / (1 - loss) // good -> bad: stationary P(bad) = g/(g+r) = loss
        this.bad = this.bad ? this.random() >= r : this.random() < g
      }
      if (this.bad) return this.stats.lost++, null
    }
    let depart = t
    if (p.rate > 0) {
      const start = Math.max(t, this.busyUntil)
      if (start - t > p.queue) return this.stats.queueDrop++, null
      this.busyUntil = start + (bytes * 8) / p.rate // kbit/s == bit/ms
      depart = this.busyUntil
    }
    const j = p.jitter > 0 ? (this.random() * 2 - 1) * p.jitter : 0
    // Never earlier than serialization, never before the previous packet: jitter without reordering.
    const due = Math.max(depart, depart + p.delay + j, this.lastDue)
    this.lastDue = due
    return due
  }

  push(buf, t, scheduler) {
    const due = this.admit(buf.length, t)
    if (due === null) return
    if (due <= t + 0.05) return this.out(buf)
    this.q.push({ due, buf })
    scheduler.wake()
  }

  out(buf) {
    this.stats.sent++
    this.stats.bytesSent += buf.length
    this.send(buf)
  }

  /** Releases due packets; returns the next due time or Infinity. */
  flush(t) {
    while (this.head < this.q.length && this.q[this.head].due <= t) this.out(this.q[this.head++].buf)
    if (this.head > 1024 && this.head * 2 > this.q.length) (this.q = this.q.slice(this.head)), (this.head = 0)
    return this.head < this.q.length ? this.q[this.head].due : Infinity
  }
}

class Scheduler {
  constructor() {
    this.links = new Set()
    this.running = false
    this.timer = null
  }
  wake() {
    if (this.running) return
    this.running = true
    setImmediate(() => this.tick())
  }
  tick() {
    const t = now()
    let next = Infinity
    for (const l of this.links) next = Math.min(next, l.flush(t))
    if (next === Infinity) return void (this.running = false)
    // Far away: sleep on a coarse timer (15.6 ms on Windows), then spin for precision.
    if (next - t > 20) this.timer = setTimeout(() => this.tick(), next - t - 17)
    else setImmediate(() => this.tick())
  }
  stop() {
    clearTimeout(this.timer)
    this.links.clear()
  }
}

/**
 * @param {{ listen: {host: string, port: number}, target: {host: string, port: number}, upstreamHost?: string,
 *   up?: object, down?: object, seed?: number, idleMs?: number }} o
 */
export async function createImpairProxy(o) {
  const up = { ...DEFAULT_PROFILE, ...o.up }
  const down = { ...DEFAULT_PROFILE, ...o.down }
  const random = rng(o.seed ?? 1)
  const sched = new Scheduler()
  const clients = new Map()
  const zero = () => ({ in: 0, sent: 0, lost: 0, outage: 0, queueDrop: 0, bytesIn: 0, bytesSent: 0 })
  const retired = { up: zero(), down: zero() } // reaped clients still count in the totals
  const listen = dgram.createSocket('udp4')
  listen.on('message', (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`
    let c = clients.get(key)
    if (!c) {
      const sock = dgram.createSocket('udp4')
      sock.bind(0, o.upstreamHost ?? '127.0.0.1')
      c = {
        key,
        sock,
        seen: now(),
        up: new Link(up, random, (b) => sock.send(b, o.target.port, o.target.host)),
        down: new Link(down, random, (b) => listen.send(b, rinfo.port, rinfo.address)),
      }
      sock.on('message', (m) => ((c.seen = now()), c.down.push(m, now(), sched)))
      sock.on('error', () => undefined)
      sched.links.add(c.up)
      sched.links.add(c.down)
      clients.set(key, c)
    }
    c.seen = now()
    c.up.push(msg, now(), sched)
  })
  listen.on('error', (e) => console.error('[udp-impair] listen error', e.message))
  await new Promise((res, rej) => {
    listen.once('error', rej)
    listen.bind(o.listen.port, o.listen.host, () => (listen.off('error', rej), res()))
  })
  // Forget clients idle for a while (closed PeerConnections), so long labs don't accumulate sockets.
  const idleMs = o.idleMs ?? 60_000
  const reaper = setInterval(() => {
    const t = now()
    for (const [k, c] of clients) {
      if (t - c.seen < idleMs) continue
      for (const d of ['up', 'down']) for (const key in retired[d]) retired[d][key] += c[d].stats[key]
      sched.links.delete(c.up)
      sched.links.delete(c.down)
      c.sock.close()
      clients.delete(k)
    }
  }, 5000)
  reaper.unref()
  const totals = (dir) => {
    const s = { ...retired[dir] }
    for (const c of clients.values()) for (const k in s) s[k] += c[dir].stats[k]
    return s
  }
  return {
    profiles: { up, down },
    /** Change a direction's profile for every client (live). dir: 'up' | 'down' | 'both'. */
    set(dir, patch) {
      for (const d of dir === 'both' ? [up, down] : [dir === 'up' ? up : down]) Object.assign(d, patch)
    },
    reset() {
      Object.assign(up, DEFAULT_PROFILE)
      Object.assign(down, DEFAULT_PROFILE)
    },
    stats: () => ({ clients: clients.size, up: totals('up'), down: totals('down') }),
    async close() {
      clearInterval(reaper)
      sched.stop()
      for (const c of clients.values()) c.sock.close()
      clients.clear()
      await new Promise((r) => listen.close(r))
    },
  }
}

// ─────────────── selftest (assert-based) ───────────────
async function selftest() {
  const assert = (ok, msg) => {
    if (!ok) throw new Error(`selftest: ${msg}`)
    console.log('ok -', msg)
  }
  // Pure model checks on Link.admit.
  const model = (profile, n = 200_000) => {
    const l = new Link({ ...DEFAULT_PROFILE, ...profile }, rng(7), () => undefined)
    let lost = 0
    let bursts = 0
    let prevLost = false
    for (let i = 0; i < n; i++) {
      const d = l.admit(100, i * 20)
      const isLost = d === null
      if (isLost) lost++
      if (isLost && !prevLost) bursts++
      prevLost = isLost
    }
    return { lossPct: (100 * lost) / n, meanBurst: lost / Math.max(1, bursts) }
  }
  const m1 = model({ loss: 10 })
  assert(Math.abs(m1.lossPct - 10) < 0.3 && Math.abs(m1.meanBurst - 1.11) < 0.05, `independent 10 % loss -> ${m1.lossPct.toFixed(2)} %, burst ${m1.meanBurst.toFixed(2)} (geometric: 1/(1-p) = 1.11)`)
  const m2 = model({ loss: 5, burst: 4 })
  assert(Math.abs(m2.lossPct - 5) < 0.4 && Math.abs(m2.meanBurst - 4) < 0.3, `burst loss 5 % mean 4 -> ${m2.lossPct.toFixed(2)} %, burst ${m2.meanBurst.toFixed(2)}`)
  const lj = new Link({ ...DEFAULT_PROFILE, delay: 50, jitter: 15 }, rng(3), () => undefined)
  let prev = 0
  let ordered = true
  let inRange = true
  for (let i = 0; i < 10_000; i++) {
    const t = i * 2
    const d = lj.admit(100, t)
    if (d < prev) ordered = false
    if (d - t < 35 - 1e-9 || d - t > 65 + 2) inRange = false
    prev = d
  }
  assert(ordered && inRange, 'delay 50 ± 15 ms stays in [35, 65] and never reorders')
  const lr = new Link({ ...DEFAULT_PROFILE, rate: 1000, queue: 100 }, rng(1), () => undefined)
  let accepted = 0
  for (let i = 0; i < 2000; i++) if (lr.admit(1250, i) !== null) accepted++ // 10 Mbit/s offered for 2 s into 1 Mbit/s
  const kbps = (accepted * 1250 * 8) / 2000
  assert(Math.abs(kbps - 1000) < 120, `1000 kbit/s cap under 10x overload delivers ${kbps.toFixed(0)} kbit/s`)

  // Real sockets: echo server behind the proxy, measure added delay precision.
  const echo = dgram.createSocket('udp4')
  await new Promise((r) => echo.bind(0, '127.0.0.1', r))
  echo.on('message', (m, ri) => echo.send(m, ri.port, ri.address))
  const proxy = await createImpairProxy({ listen: { host: '127.0.0.2', port: 47892 }, target: { host: '127.0.0.1', port: echo.address().port }, up: { delay: 20 }, down: { delay: 20 } })
  const cli = dgram.createSocket('udp4')
  await new Promise((r) => cli.bind(0, '127.0.0.1', r))
  const rtts = []
  await new Promise((res) => {
    let i = 0
    const sent = new Map()
    cli.on('message', (m) => {
      rtts.push(now() - sent.get(m.readUInt32BE(0)))
      if (rtts.length >= 200) res()
    })
    const tick = setInterval(() => {
      const b = Buffer.alloc(160)
      b.writeUInt32BE(i)
      sent.set(i++, now())
      cli.send(b, 47892, '127.0.0.2')
      if (i >= 200) clearInterval(tick)
    }, 5)
  })
  rtts.sort((a, b) => a - b)
  const p50 = rtts[100]
  const p99 = rtts[198]
  assert(p50 > 39.5 && p50 < 41.5 && p99 < 43, `40 ms configured RTT through real sockets: p50 ${p50.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms`)
  cli.close()
  echo.close()
  await proxy.close()
  return { lossModel: [m1, m2], rateKbps: kbps, rttMs: { p50, p99, min: rtts[0], max: rtts[199] } }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  const get = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  if (argv.includes('--selftest')) {
    selftest().then((r) => console.log(JSON.stringify(r)), (e) => (console.error(e.message), process.exit(1)))
  } else {
    const hp = (s) => ({ host: s.split(':')[0], port: Number(s.split(':')[1]) })
    const target = hp(get('target') ?? '127.0.0.1:7892')
    const proxy = await createImpairProxy({ listen: hp(get('listen') ?? '127.0.0.2:7892'), target, upstreamHost: get('upstream') ?? target.host, up: parseProfile(get('up')), down: parseProfile(get('down')) })
    console.log('[udp-impair] up', proxy.profiles.up, 'down', proxy.profiles.down)
    setInterval(() => console.log('[udp-impair]', JSON.stringify(proxy.stats())), 5000).unref()
    process.on('SIGINT', () => void proxy.close().then(() => process.exit(0)))
  }
}
