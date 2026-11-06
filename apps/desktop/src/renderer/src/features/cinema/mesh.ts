import { CINEMA_LANES, type CinemaClientFrame, type CinemaIceServer, type CinemaSeat, type CinemaSignal } from '@alga/shared'

const MAX_RETRIES = 2
const RELAY_REFRESH_MS = 3000
const CONNECT_TIMEOUT_MS = 20_000
const MAX_EARLY = 200
const MAX_QUEUED = 100
/** The offerer opens lane k > 0 this long × k after lane 0's channels are open (spreads the signalling; lane 0 starts the film). */
export const LANE_STAGGER_MS = 2_000
/** Lanes > 0 wait (at most this long) for ICE gathering and send their candidates inside the description: one frame per side. */
export const GATHER_WAIT_MS = 2_000

/** The smaller id makes the offers and creates the data channels; the other side answers. */
export function isOfferer(selfId: string, peerId: string): boolean {
  return selfId < peerId
}

/** Groups ICE candidates: up to `max` per frame, or whatever is pending `waitMs` after the first one. */
export class CandidateBatcher {
  private buf: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private readonly max: number
  private readonly waitMs: number
  constructor(private readonly flush: (c: string[]) => void, opts: { max?: number; waitMs?: number } = {}) {
    this.max = opts.max ?? 20
    this.waitMs = opts.waitMs ?? 200
  }
  add(c: string): void {
    if (this.closed) return
    this.buf.push(c)
    if (this.buf.length >= this.max) this.drain()
    else if (!this.timer) this.timer = setTimeout(() => this.drain(), this.waitMs)
  }
  close(): void {
    this.closed = true
    this.buf = []
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private drain(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const out = this.buf
    this.buf = []
    if (out.length) this.flush(out)
  }
}

/** What the MLS tag authenticates: the session, the direction, the DTLS fingerprint and (lanes > 0) the lane. */
export function tagInput(sessionId: string, from: string, to: string, fingerprint: string, lane = 0): string {
  return `${sessionId}|${from}|${to}|${fingerprint}${lane ? `|${lane}` : ''}`
}

/**
 * The SDP's single DTLS fingerprint, normalized as `sha-256 AB:CD:...`. Session-level and media-level lines are all
 * collected (RFC 8122: a media-level one overrides the session one, so trusting only the first would let a signalling
 * attacker hide their own). Null unless there is exactly one distinct, well-formed value.
 */
export function fingerprintOf(sdp: string): string | null {
  const seen = new Set<string>()
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=fingerprint:')) continue
    const m = /^a=fingerprint:([A-Za-z0-9-]+) ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2})*)\s*$/.exec(line)
    if (!m) return null
    seen.add(`${m[1]!.toLowerCase()} ${m[2]!.toUpperCase()}`)
  }
  return seen.size === 1 ? ([...seen][0] ?? null) : null
}

const BUFFER_PEERS = 8
const BUFFER_PER_PEER = 50
const BUFFER_TTL_MS = 10_000

/** Holds signals from peers we have not seated yet (seat updates and signals race), to replay once sync() adds them. */
export class SignalBuffer {
  private byPeer = new Map<string, { at: number; s: CinemaSignal }[]>()
  add(from: string, s: CinemaSignal, now = Date.now()): void {
    this.expire(now)
    let list = this.byPeer.get(from)
    if (!list) {
      if (this.byPeer.size >= BUFFER_PEERS) return
      this.byPeer.set(from, (list = []))
    }
    if (list.length < BUFFER_PER_PEER) list.push({ at: now, s })
  }
  take(from: string, now = Date.now()): CinemaSignal[] {
    this.expire(now)
    const list = this.byPeer.get(from) ?? []
    this.byPeer.delete(from)
    return list.map((e) => e.s)
  }
  private expire(now: number): void {
    for (const [id, list] of this.byPeer) {
      const live = list.filter((e) => now - e.at < BUFFER_TTL_MS)
      if (live.length) this.byPeer.set(id, live)
      else this.byPeer.delete(id)
    }
  }
}

/** One RTCPeerConnection of a pair: an ordered control channel and an unordered (still reliable) bulk channel. */
interface Lane {
  k: number
  pc: RTCPeerConnection
  batcher: CandidateBatcher
  retries: number
  /** ICE candidates that arrived before the remote description. */
  early: string[]
  ctl: RTCDataChannel | null
  bulk: RTCDataChannel | null
  announced: boolean
  /** Opening or open. An answerer's lane > 0 sits idle (and does not keep the peer) until its offer comes. */
  active: boolean
  /** Lanes > 0 send their first candidates inside the description; candidates are trickled once it is out. */
  trickle: boolean
  /** Fires if the channels are not open in time; cleared on open. */
  timer: ReturnType<typeof setTimeout> | null
  /** getStats totals at the last refresh (RTT over the interval). */
  rtt: { responses: number; total: number }
}

/** A peer: up to CINEMA_LANES connections. It stays while any lane is opening or open. */
interface Pair { offerer: boolean; lanes: Map<number, Lane>; staggered: boolean; stagger: ReturnType<typeof setTimeout>[] }

type TagFn = (channelId: string, epoch: number, message: string) => Promise<string | null>
type LaneCb = (peerId: string, lane: number, ctl: RTCDataChannel, bulk: RTCDataChannel) => void

/**
 * The cinema's own P2P mesh (spec §6.4): CINEMA_LANES RTCPeerConnections per pair of seats, because one SCTP association
 * collapses under loss or a bloated uplink (measured ~2.5 Mbps at 1 % loss and 40 ms RTT). Lane 0 opens at once; the
 * offerer opens lanes 1.. LANE_STAGGER_MS apart once lane 0 is up. Every lane is authenticated like lane 0 (E2EE tag over
 * its own DTLS fingerprint and its lane). A lane that fails is dropped; the peer stays while another lane is up and is
 * gone (re-opened by the next sync) when the last one goes.
 */
export class Mesh {
  private pairs = new Map<string, Pair>()
  private wanted = new Set<string>()
  private laneCbs = new Set<LaneCb>()
  private laneGoneCbs = new Set<(peerId: string, lane: number) => void>()
  private goneCbs = new Set<(peerId: string) => void>()
  private rttCbs = new Set<(peerId: string, lane: number, rttMs: number) => void>()
  private relay = new Set<string>()
  private relayTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private buffer = new SignalBuffer()
  private queues = new Map<string, { tail: Promise<void>; n: number }>()
  private tagOf: TagFn

  /** `e2ee.epoch()` is read at send time (MLS epochs change on every join/leave); received tags use the sender's epoch. */
  constructor(private readonly opts: {
    sessionId: string; channelId: string; selfId: string; iceServers: CinemaIceServer[]
    e2ee: { epoch(): number } | null; send: (f: CinemaClientFrame) => boolean
    cinemaTag?: TagFn
    /** Connections per pair (default and maximum CINEMA_LANES). */
    lanes?: number
  }) {
    this.tagOf = opts.cinemaTag ?? ((c, e, m) => window.alga.e2ee.cinemaTag(c, e, m))
  }

  sync(seats: CinemaSeat[]): void {
    if (this.closed) return
    this.wanted = new Set(seats.filter((s) => s.direct && s.userId !== this.opts.selfId).map((s) => s.userId))
    for (const id of [...this.pairs.keys()]) if (!this.wanted.has(id)) this.drop(id)
    for (const id of this.wanted) {
      if (this.pairs.has(id)) continue
      this.openPair(id)
      for (const s of this.buffer.take(id)) void this.onSignal(id, s)
    }
  }

  /** Signals of one peer (all its lanes) are handled strictly in order (ICE must see the description that preceded it). */
  onSignal(from: string, s: CinemaSignal): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (!this.wanted.has(from)) {
      this.buffer.add(from, s)
      return Promise.resolve()
    }
    const q = this.queues.get(from) ?? { tail: Promise.resolve(), n: 0 }
    this.queues.set(from, q)
    if (q.n >= MAX_QUEUED) return Promise.resolve()
    q.n++
    const lane = this.pairs.get(from)?.lanes.get(s.lane ?? 0)
    q.tail = q.tail.then(() => this.handle(from, s, lane)).catch(() => {}).finally(() => { q.n-- })
    return q.tail
  }

  private async handle(from: string, s: CinemaSignal, lane: Lane | undefined): Promise<void> {
    // Only sync() opens pairs; the lane is captured at enqueue time so a queued signal never hits a re-opened one.
    if (this.closed || !lane || !this.isLive(from, lane)) return
    const pair = this.pairs.get(from)!
    try {
      if (s.kind === 'ice') {
        if (lane.pc.remoteDescription) for (const c of s.candidates) await this.addCandidate(lane, c)
        else if (lane.early.length < MAX_EARLY) lane.early.push(...s.candidates.slice(0, MAX_EARLY - lane.early.length))
        return
      }
      // a description failing E2EE on any lane drops the whole pair (fail closed)
      if (!(await this.verify(from, s))) return this.drop(from)
      if (!this.isLive(from, lane)) return
      if (s.kind === 'offer') {
        // Roles are fixed by id: an offer only ever comes from the smaller id. Anything else is glare or forgery: ignore.
        if (pair.offerer) return
        await lane.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp })
        if (!lane.active) {
          lane.active = true
          this.armTimer(from, lane)
        }
        await lane.pc.setLocalDescription()
        await this.sendDescription(from, lane, 'answer')
      } else {
        if (!pair.offerer || lane.pc.signalingState !== 'have-local-offer') return
        await lane.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp })
      }
      for (const c of lane.early.splice(0)) await this.addCandidate(lane, c)
    } catch (e) {
      console.warn('[cinema/mesh] signal from', from, 'lane', lane.k, 'failed:', e)
      this.dropLane(from, lane)
    }
  }

  /** A lane's two channels are open. Also replays open lanes, so late subscribers miss nothing. */
  onLane(cb: LaneCb): () => void {
    this.laneCbs.add(cb)
    for (const [id, p] of this.pairs) for (const l of p.lanes.values()) if (l.announced && l.ctl && l.bulk) cb(id, l.k, l.ctl, l.bulk)
    return () => this.laneCbs.delete(cb)
  }

  /** An announced lane closed while the peer keeps another one. */
  onLaneGone(cb: (peerId: string, lane: number) => void): () => void {
    this.laneGoneCbs.add(cb)
    return () => this.laneGoneCbs.delete(cb)
  }

  /** The peer's last lane closed, or it left the mesh. */
  onPeerGone(cb: (peerId: string) => void): () => void {
    this.goneCbs.add(cb)
    return () => this.goneCbs.delete(cb)
  }

  /** Each open lane's round-trip time (ms), every RELAY_REFRESH_MS, from its selected candidate pair. */
  onRtt(cb: (peerId: string, lane: number, rttMs: number) => void): () => void {
    this.rttCbs.add(cb)
    return () => this.rttCbs.delete(cb)
  }

  /** Peers with a lane whose selected candidate pair goes through a relay (cached; refreshed every few seconds). */
  relayed(): string[] {
    return [...this.relay]
  }

  /** Self-initiated teardown: onPeerGone is NOT fired for it (the owner is closing everything anyway). */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const id of [...this.pairs.keys()]) this.drop(id, false)
    this.laneCbs.clear()
    this.laneGoneCbs.clear()
    this.goneCbs.clear()
    this.rttCbs.clear()
    this.queues.clear()
  }

  private openPair(id: string): void {
    const pair: Pair = { offerer: isOfferer(this.opts.selfId, id), lanes: new Map(), staggered: false, stagger: [] }
    this.pairs.set(id, pair)
    this.openLane(id, pair, 0)
    // the answerer has every lane ready (idle) for its offer; the offerer opens lanes > 0 once lane 0 is up
    if (!pair.offerer) for (let k = 1; k < this.laneCount(); k++) this.openLane(id, pair, k)
    this.ensureRelayTimer()
  }

  private laneCount(): number {
    return Math.max(1, Math.min(CINEMA_LANES, this.opts.lanes ?? CINEMA_LANES))
  }

  private openLane(id: string, pair: Pair, k: number): void {
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers, iceTransportPolicy: 'all' })
    const lane: Lane = {
      k, pc, retries: 0, early: [], ctl: null, bulk: null, announced: false, active: pair.offerer || k === 0, trickle: k === 0,
      timer: null, rtt: { responses: 0, total: 0 },
      batcher: new CandidateBatcher((candidates) => this.signal(id, { kind: 'ice', candidates, ...(k ? { lane: k } : {}) })),
    }
    pair.lanes.set(k, lane)
    pc.onicecandidate = (e) => { if (e.candidate?.candidate && lane.trickle) lane.batcher.add(e.candidate.candidate) }
    pc.onconnectionstatechange = () => {
      if (!this.isLive(id, lane)) return
      if (pc.connectionState === 'closed') return this.dropLane(id, lane)
      if (pc.connectionState === 'connected') {
        lane.retries = 0
        // Recovered: the re-armed connect timer must not fire later (the channels are open, so `opened` will not clear it).
        if (lane.announced && lane.timer) { clearTimeout(lane.timer); lane.timer = null }
      }
      if (pc.connectionState === 'failed') this.fail(id, lane)
    }
    if (lane.active) this.armTimer(id, lane)
    if (pair.offerer) {
      pc.onnegotiationneeded = () => {
        void (async () => {
          try {
            await pc.setLocalDescription()
            await this.sendDescription(id, lane, 'offer')
          } catch (e) {
            console.warn('[cinema/mesh] offer to', id, 'lane', k, 'failed:', e)
            this.dropLane(id, lane)
          }
        })()
      }
      // control messages (whose order matters) go on the ordered channel; chunks, addressed by offset, on the unordered one
      this.attach(id, lane, pc.createDataChannel('cinema-ctl', { ordered: true }))
      this.attach(id, lane, pc.createDataChannel('cinema', { ordered: false }))
    } else {
      pc.ondatachannel = (e) => this.attach(id, lane, e.channel)
    }
  }

  private isLive(id: string, lane: Lane): boolean {
    return this.pairs.get(id)?.lanes.get(lane.k) === lane
  }

  /** Failed or timed out: the offerer retries with an ICE restart (twice), then the lane is given up. */
  private fail(id: string, lane: Lane): void {
    if (!this.isLive(id, lane)) return
    if (lane.pc.connectionState === 'connected' && lane.announced) return
    if (++lane.retries > MAX_RETRIES) return this.dropLane(id, lane)
    // Only the offerer renegotiates; the other side just counts failures and waits for its offer.
    if (this.pairs.get(id)?.offerer) lane.pc.restartIce()
    this.armTimer(id, lane)
  }

  private armTimer(id: string, lane: Lane): void {
    if (lane.timer) clearTimeout(lane.timer)
    lane.timer = setTimeout(() => this.fail(id, lane), CONNECT_TIMEOUT_MS)
  }

  private attach(id: string, lane: Lane, ch: RTCDataChannel): void {
    if (ch.label === 'cinema-ctl' && !lane.ctl) lane.ctl = ch
    else if (ch.label === 'cinema' && !lane.bulk) lane.bulk = ch
    else return
    ch.binaryType = 'arraybuffer'
    const opened = () => {
      const { ctl, bulk } = lane
      if (lane.announced || !this.isLive(id, lane) || ctl?.readyState !== 'open' || bulk?.readyState !== 'open') return
      if (lane.timer) clearTimeout(lane.timer)
      lane.timer = null
      lane.announced = true
      for (const cb of this.laneCbs) cb(id, lane.k, ctl, bulk)
      if (lane.k === 0) this.staggerLanes(id)
    }
    ch.onopen = opened
    ch.onclose = () => { if (this.isLive(id, lane)) this.dropLane(id, lane) }
    opened()
  }

  /** Offerer: lanes 1.. open LANE_STAGGER_MS apart once lane 0 is up (once per pair: a failed lane is not re-opened). */
  private staggerLanes(id: string): void {
    const pair = this.pairs.get(id)
    if (!pair?.offerer || pair.staggered) return
    pair.staggered = true
    for (let k = 1; k < this.laneCount(); k++) {
      pair.stagger.push(setTimeout(() => {
        if (!this.closed && this.pairs.get(id) === pair && !pair.lanes.has(k)) this.openLane(id, pair, k)
      }, k * LANE_STAGGER_MS))
    }
  }

  /** Drops one lane; the peer goes with it when no other lane is opening or open. */
  private dropLane(id: string, lane: Lane): void {
    const pair = this.pairs.get(id)
    if (!pair || pair.lanes.get(lane.k) !== lane) return
    pair.lanes.delete(lane.k)
    this.closeLane(lane)
    if (![...pair.lanes.values()].some((l) => l.active)) return this.drop(id)
    if (lane.announced) for (const cb of this.laneGoneCbs) cb(id, lane.k)
  }

  private closeLane(lane: Lane): void {
    lane.batcher.close()
    if (lane.timer) clearTimeout(lane.timer)
    const { pc } = lane
    pc.onicecandidate = pc.onconnectionstatechange = pc.onnegotiationneeded = pc.ondatachannel = null
    for (const ch of [lane.ctl, lane.bulk]) {
      if (!ch) continue
      ch.onclose = ch.onopen = null
      try { ch.close() } catch { /* already closed */ }
    }
    try { pc.close() } catch { /* already closed */ }
  }

  private drop(id: string, notify = true): void {
    const pair = this.pairs.get(id)
    if (!pair) return
    this.pairs.delete(id)
    this.queues.delete(id)
    this.relay.delete(id)
    for (const t of pair.stagger) clearTimeout(t)
    for (const lane of pair.lanes.values()) this.closeLane(lane)
    if (this.pairs.size === 0 && this.relayTimer) {
      clearInterval(this.relayTimer)
      this.relayTimer = null
    }
    if (notify) for (const cb of this.goneCbs) cb(id)
  }

  private signal(to: string, signal: CinemaSignal): void {
    this.opts.send({ op: 'cinema_signal', sessionId: this.opts.sessionId, to, signal })
  }

  private async addCandidate(lane: Lane, candidate: string): Promise<void> {
    try { await lane.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 }) } catch { /* stale candidate after a restart */ }
  }

  /** Resolves when ICE gathering completes, or after GATHER_WAIT_MS. */
  private gathered(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((done) => {
      const finish = (): void => {
        clearTimeout(timer)
        pc.onicegatheringstatechange = null
        done()
      }
      const timer = setTimeout(finish, GATHER_WAIT_MS)
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') finish() }
    })
  }

  /**
   * Sends the local description; in an E2EE call it carries the current epoch and the MLS tag over our DTLS fingerprint
   * (and lane). Lanes > 0 first wait for ICE gathering, so their candidates ride in the description.
   */
  private async sendDescription(to: string, lane: Lane, kind: 'offer' | 'answer'): Promise<void> {
    if (lane.k) await this.gathered(lane.pc)
    const sdp = lane.pc.localDescription?.sdp
    if (!sdp) throw new Error('no local description')
    const { e2ee, sessionId, channelId, selfId } = this.opts
    let auth: { tag: string; epoch: number } | null = null
    if (e2ee) {
      const epoch = e2ee.epoch()
      const fp = fingerprintOf(sdp)
      const tag = fp ? await this.tagOf(channelId, epoch, tagInput(sessionId, selfId, to, fp, lane.k)) : null
      // Never send an unauthenticated description in an E2EE call.
      if (!tag) throw new Error('no E2EE tag for the local fingerprint')
      auth = { tag, epoch }
    }
    if (!this.isLive(to, lane)) return
    // candidates gathered from now on are trickled (the earlier ones are in this description)
    lane.trickle = true
    this.signal(to, { kind, sdp, ...auth, ...(lane.k ? { lane: lane.k } : {}) })
  }

  /** Non-E2EE: always true. E2EE: the tag must match what we compute from the sender's epoch, the SDP's fingerprint and the lane. */
  private async verify(from: string, s: Extract<CinemaSignal, { kind: 'offer' | 'answer' }>): Promise<boolean> {
    const { e2ee, sessionId, channelId, selfId } = this.opts
    if (!e2ee) return true
    const fp = fingerprintOf(s.sdp)
    const epochOk = s.epoch !== undefined && Number.isInteger(s.epoch) && s.epoch >= 0
    const expected = fp && s.tag && epochOk
      ? await this.tagOf(channelId, s.epoch!, tagInput(sessionId, from, selfId, fp, s.lane ?? 0))
      : null
    if (!expected || expected !== s.tag) {
      console.warn('[cinema/mesh] rejecting', s.kind, 'from', from, ': E2EE fingerprint tag missing or wrong')
      return false
    }
    return true
  }

  private ensureRelayTimer(): void {
    if (this.relayTimer) return
    this.relayTimer = setInterval(() => void this.refreshStats(), RELAY_REFRESH_MS)
  }

  /** Relay use and per-lane RTT (mean over the interval's ICE checks, else the current one) from each selected pair. */
  private async refreshStats(): Promise<void> {
    const next = new Set<string>()
    const lanes = [...this.pairs].flatMap(([id, p]) => [...p.lanes.values()].map((l) => [id, l] as const))
    await Promise.all(lanes.map(async ([id, lane]) => {
      try {
        const byId = new Map<string, Record<string, any>>()
        ;(await lane.pc.getStats()).forEach((r) => byId.set(r.id, r))
        let pairId: string | undefined
        byId.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId })
        const pair = pairId ? byId.get(pairId) : [...byId.values()].find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded')
        if (!pair) return
        if ([pair.localCandidateId, pair.remoteCandidateId].some((c) => byId.get(c)?.candidateType === 'relay')) next.add(id)
        const responses: number = pair.responsesReceived ?? 0
        const total: number = pair.totalRoundTripTime ?? 0
        const n = responses - lane.rtt.responses
        const rttS = n > 0 ? (total - lane.rtt.total) / n : pair.currentRoundTripTime
        lane.rtt = { responses, total }
        if (lane.announced && typeof rttS === 'number' && rttS > 0 && this.isLive(id, lane)) for (const cb of this.rttCbs) cb(id, lane.k, rttS * 1000)
      } catch { /* connection closing */ }
    }))
    if (!this.closed) this.relay = new Set([...next].filter((id) => this.pairs.has(id)))
  }
}
