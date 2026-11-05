import type { CinemaClientFrame, CinemaIceServer, CinemaSeat, CinemaSignal } from '@alga/shared'

const MAX_RETRIES = 2
const RELAY_REFRESH_MS = 3000

/** The smaller id makes the offer and creates the data channel; the other side answers. */
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

/** What the MLS tag authenticates: the session, the direction and the DTLS fingerprint. */
export function tagInput(sessionId: string, from: string, to: string, fingerprint: string): string {
  return `${sessionId}|${from}|${to}|${fingerprint}`
}

/** `sha-256 AB:CD:...` from the SDP's first `a=fingerprint:` line, or null. */
export function fingerprintOf(sdp: string): string | null {
  const m = /^a=fingerprint:(\S+ \S+)\s*$/m.exec(sdp)
  return m?.[1] ?? null
}

interface Link {
  pc: RTCPeerConnection
  batcher: CandidateBatcher
  offerer: boolean
  retries: number
  /** ICE candidates that arrived before the remote description. */
  early: string[]
  ch: RTCDataChannel | null
  announced: boolean
}

export class Mesh {
  private links = new Map<string, Link>()
  private wanted = new Set<string>()
  private channelCbs = new Set<(peerId: string, ch: RTCDataChannel) => void>()
  private goneCbs = new Set<(peerId: string) => void>()
  private relay = new Set<string>()
  private relayTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(private readonly opts: {
    sessionId: string; channelId: string; selfId: string; iceServers: CinemaIceServer[]
    e2ee: { epoch: number } | null; send: (f: CinemaClientFrame) => boolean
  }) {}

  sync(seats: CinemaSeat[]): void {
    if (this.closed) return
    this.wanted = new Set(seats.filter((s) => s.direct && s.userId !== this.opts.selfId).map((s) => s.userId))
    for (const id of [...this.links.keys()]) if (!this.wanted.has(id)) this.drop(id)
    for (const id of this.wanted) if (!this.links.has(id)) this.open(id)
  }

  async onSignal(from: string, s: CinemaSignal): Promise<void> {
    if (this.closed || !this.wanted.has(from)) return
    const link = this.links.get(from) ?? this.open(from)
    try {
      if (s.kind === 'ice') {
        if (link.pc.remoteDescription) for (const c of s.candidates) await this.addCandidate(link, c)
        else link.early.push(...s.candidates)
        return
      }
      if (!(await this.verify(from, s))) return this.drop(from)
      if (s.kind === 'offer') {
        // Roles are fixed by id: an offer only ever comes from the smaller id. Anything else is glare or forgery: ignore.
        if (link.offerer) return
        await link.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp })
        await link.pc.setLocalDescription()
        await this.sendDescription(from, link, 'answer')
      } else {
        if (!link.offerer || link.pc.signalingState !== 'have-local-offer') return
        await link.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp })
      }
      for (const c of link.early.splice(0)) await this.addCandidate(link, c)
    } catch (e) {
      console.warn('[cinema/mesh] signal from', from, 'failed:', e)
      this.drop(from)
    }
  }

  onChannel(cb: (peerId: string, ch: RTCDataChannel) => void): () => void {
    this.channelCbs.add(cb)
    return () => this.channelCbs.delete(cb)
  }

  onPeerGone(cb: (peerId: string) => void): () => void {
    this.goneCbs.add(cb)
    return () => this.goneCbs.delete(cb)
  }

  /** Peers whose selected candidate pair goes through a relay (cached; refreshed every few seconds). */
  relayed(): string[] {
    return [...this.relay]
  }

  close(): void {
    if (this.closed) return
    for (const id of [...this.links.keys()]) this.drop(id)
    this.closed = true
    this.channelCbs.clear()
    this.goneCbs.clear()
    if (this.relayTimer) clearInterval(this.relayTimer)
    this.relayTimer = null
  }

  private open(id: string): Link {
    const { selfId, iceServers } = this.opts
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' })
    const link: Link = {
      pc, offerer: isOfferer(selfId, id), retries: 0, early: [], ch: null, announced: false,
      batcher: new CandidateBatcher((candidates) => this.signal(id, { kind: 'ice', candidates })),
    }
    this.links.set(id, link)
    pc.onicecandidate = (e) => { if (e.candidate?.candidate) link.batcher.add(e.candidate.candidate) }
    pc.onconnectionstatechange = () => {
      if (this.links.get(id) !== link) return
      if (pc.connectionState === 'closed') return this.drop(id)
      if (pc.connectionState !== 'failed') return
      if (++link.retries > MAX_RETRIES) return this.drop(id)
      // Only the offerer renegotiates; the other side just counts the failures and gives up on the third.
      if (link.offerer) pc.restartIce()
    }
    if (link.offerer) {
      pc.onnegotiationneeded = () => {
        void (async () => {
          try {
            await pc.setLocalDescription()
            await this.sendDescription(id, link, 'offer')
          } catch (e) {
            console.warn('[cinema/mesh] offer to', id, 'failed:', e)
            this.drop(id)
          }
        })()
      }
      this.attach(id, link, pc.createDataChannel('cinema', { ordered: true }))
    } else {
      pc.ondatachannel = (e) => { if (e.channel.label === 'cinema' && !link.ch) this.attach(id, link, e.channel) }
    }
    this.ensureRelayTimer()
    return link
  }

  private attach(id: string, link: Link, ch: RTCDataChannel): void {
    ch.binaryType = 'arraybuffer'
    link.ch = ch
    const announce = () => {
      if (link.announced || this.links.get(id) !== link) return
      link.announced = true
      for (const cb of this.channelCbs) cb(id, ch)
    }
    ch.onopen = announce
    ch.onclose = () => { if (this.links.get(id) === link) this.drop(id) }
    if (ch.readyState === 'open') announce()
  }

  private drop(id: string): void {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    this.relay.delete(id)
    link.batcher.close()
    link.pc.onicecandidate = link.pc.onconnectionstatechange = link.pc.onnegotiationneeded = link.pc.ondatachannel = null
    if (link.ch) link.ch.onclose = link.ch.onopen = null
    try { link.ch?.close() } catch { /* already closed */ }
    try { link.pc.close() } catch { /* already closed */ }
    for (const cb of this.goneCbs) cb(id)
  }

  private signal(to: string, signal: CinemaSignal): void {
    this.opts.send({ op: 'cinema_signal', sessionId: this.opts.sessionId, to, signal })
  }

  private async addCandidate(link: Link, candidate: string): Promise<void> {
    try { await link.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 }) } catch { /* stale candidate after a restart */ }
  }

  /** Sends the local description; in an E2EE call it carries the epoch and the MLS tag over our DTLS fingerprint. */
  private async sendDescription(to: string, link: Link, kind: 'offer' | 'answer'): Promise<void> {
    const sdp = link.pc.localDescription?.sdp
    if (!sdp) throw new Error('no local description')
    const { e2ee, sessionId, channelId, selfId } = this.opts
    if (!e2ee) return this.signal(to, { kind, sdp })
    const fp = fingerprintOf(sdp)
    const tag = fp ? await window.alga.e2ee.cinemaTag(channelId, e2ee.epoch, tagInput(sessionId, selfId, to, fp)) : null
    // Never send an unauthenticated description in an E2EE call.
    if (!tag) throw new Error('no E2EE tag for the local fingerprint')
    this.signal(to, { kind, sdp, tag, epoch: e2ee.epoch })
  }

  /** Non-E2EE: always true. E2EE: the tag must match what we compute from the sender's epoch and the SDP's fingerprint. */
  private async verify(from: string, s: Extract<CinemaSignal, { kind: 'offer' | 'answer' }>): Promise<boolean> {
    const { e2ee, sessionId, channelId, selfId } = this.opts
    if (!e2ee) return true
    const fp = fingerprintOf(s.sdp)
    const expected = fp && s.tag && s.epoch !== undefined
      ? await window.alga.e2ee.cinemaTag(channelId, s.epoch, tagInput(sessionId, from, selfId, fp))
      : null
    if (!expected || expected !== s.tag) {
      console.warn('[cinema/mesh] rejecting', s.kind, 'from', from, ': E2EE fingerprint tag missing or wrong')
      return false
    }
    return true
  }

  private ensureRelayTimer(): void {
    if (this.relayTimer) return
    this.relayTimer = setInterval(() => void this.refreshRelay(), RELAY_REFRESH_MS)
  }

  private async refreshRelay(): Promise<void> {
    const next = new Set<string>()
    await Promise.all([...this.links].map(async ([id, { pc }]) => {
      try {
        const byId = new Map<string, Record<string, any>>()
        ;(await pc.getStats()).forEach((r) => byId.set(r.id, r))
        let pairId: string | undefined
        byId.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId })
        const pair = pairId ? byId.get(pairId) : [...byId.values()].find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded')
        if (pair && [pair.localCandidateId, pair.remoteCandidateId].some((c) => byId.get(c)?.candidateType === 'relay')) next.add(id)
      } catch { /* connection closing */ }
    }))
    if (!this.closed) this.relay = new Set([...next].filter((id) => this.links.has(id)))
  }
}
