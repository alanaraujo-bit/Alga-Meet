import type { CinemaPieceMeta, CinemaSessionView, Dispatch } from '@alga/shared'
import { CINEMA_HOST_AWAY_MS, CINEMA_ITEMS_PER_FRAME, CINEMA_READY_TIMEOUT_MS, CINEMA_SEEK_READY_S } from '@alga/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CH = '0190a0a0-0000-7000-8000-00000000c0c0'
const SID = '0190a0a0-0000-7000-8000-000000005e55'

// ---- fakes: gateway, media/data stores, engine pieces and the main bridge -----------------------------------------------
const sent: Record<string, unknown>[] = []
const sessionFlags = { cinema: false }
vi.mock('@/store/session', () => ({
  onDispatch: () => () => undefined,
  useSession: { getState: () => ({ cinema: sessionFlags.cinema, send: (f: Record<string, unknown>) => (sent.push(f), true) }) },
}))
vi.mock('@/store/data', async () => {
  const { create } = await import('zustand')
  return { useData: create(() => ({ me: { id: 'me' }, users: {} })) }
})
vi.mock('@/media/store', async () => {
  const { create } = await import('zustand')
  return { useMedia: create(() => ({ connection: { state: 'connected', channelId: CH }, e2ee: { state: 'off', epoch: null }, devices: { outputId: null, outputs: [] } })) }
})
const engine = vi.hoisted(() => ({ swarms: [] as any[], meshes: [] as any[], caches: 0 }))
vi.mock('./swarm/swarm', () => ({
  Swarm: class {
    setIndex = vi.fn()
    setTracks = vi.fn()
    setPlayhead = vi.fn()
    addPeer = vi.fn()
    removePeer = vi.fn()
    aheadS = (_track?: string) => 0
    recvMbps = (): number | null => null
    setCriticalS = vi.fn()
    addLane = vi.fn()
    removeLane = vi.fn()
    setRtt = vi.fn()
    pieces = () => []
    get = async () => null
    stats = () => ({ fromHostPct: 0, fromPeersPct: 0, downMbps: 0, upMbps: 0, peers: 0 })
    onPiece = () => () => undefined
    close = vi.fn(async () => undefined)
    constructor(readonly opts: unknown) {
      engine.swarms.push(this)
    }
  },
}))
vi.mock('./swarm/cache', () => ({
  createPieceCache: async (_s: string, capBytes: number) => (engine.caches++, { cache: {}, kind: 'memory', capBytes }),
  clearStaleOpfs: async () => undefined,
}))
vi.mock('./mesh', () => ({
  Mesh: class {
    calls: string[] = []
    sync = vi.fn(() => this.calls.push('sync'))
    onSignal = vi.fn(async () => void this.calls.push('signal'))
    onLane = () => () => undefined
    onLaneGone = () => () => undefined
    onPeerGone = () => () => undefined
    onRtt = () => () => undefined
    relayed = () => []
    close = vi.fn()
    constructor(readonly opts: unknown) {
      engine.meshes.push(this)
    }
  },
}))
const players = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('./player', () => ({
  CinemaPlayer: class {
    stall: (stalled: boolean) => void = () => undefined
    setAudio = vi.fn(async () => undefined)
    apply = vi.fn()
    destroy = vi.fn()
    stats = () => ({ droppedFrames: 0, syncErrP95Ms: 0, bufferedAheadS: 0 })
    onStall(cb: (stalled: boolean) => void) {
      this.stall = cb
      return () => undefined
    }
    onError = () => () => undefined
    constructor() {
      players.list.push(this)
    }
  },
  canPlay: async () => ({ ok: true }),
}))
vi.mock('./audio', () => ({
  FilmAudio: { for: () => ({ setVolume() {}, setMuted() {}, setDucking() {}, setOutput: async () => undefined, echoRisk: () => false, outputLatencyMs: () => 0, release() {} }) },
}))
const bridge = {
  checkFfmpeg: vi.fn(async () => ({ ok: true, version: 'n9' }) as { ok: true; version: string } | { ok: false; reason: 'blocked' | 'missing' | 'crashed'; detail: string }),
  pick: vi.fn(async () => ({ fileId: 'f1', name: 'Duna.2024.mkv' })),
  probe: vi.fn(),
  start: vi.fn(async () => undefined),
  ensure: vi.fn(),
  setPlayhead: vi.fn(),
  piece: vi.fn(async () => null),
  close: vi.fn(async () => undefined),
  onPieces: vi.fn((cb: (e: { fileId: string; track: string; from: number; items: CinemaPieceMeta[] }) => void) => ((bridge.emitPieces = cb), () => undefined)),
  onError: vi.fn(() => () => undefined),
  emitPieces: null as null | ((e: { fileId: string; track: string; from: number; items: CinemaPieceMeta[] }) => void),
}
vi.stubGlobal('window', { alga: { cinema: bridge, e2ee: { cinemaTag: async () => null } } })

const { handleCinemaDispatch, onMediaChange, useCinema, resetCinema, attachVideo, detachVideo, readyAheadS, extraPiece, startCinema } = await import('./store')
const { useMedia } = await import('@/media/store')
const { openFromFile, openSession } = await import('./actions')
const { t } = await import('./strings')

const film = {
  title: 'Duna (2024)', durationS: 600, width: 1920, height: 1080, hdr: 'sdr' as const, videoCodec: 'h264' as const,
  videoMime: 'video/mp4; codecs="avc1.640028"', bitrateKbps: 8000,
  audio: [{ id: 0, lang: 'por', title: null, sourceCodec: 'aac', channels: 2, out: 'copy' as const, mime: 'audio/mp4; codecs="mp4a.40.2"', default: true }],
  subtitles: [], chapters: [], episode: null,
}
const view = (over: Partial<CinemaSessionView> = {}): CinemaSessionView => ({
  sessionId: SID, channelId: CH, hostId: 'ana', film,
  playback: { playing: false, position: 0, at: 0, seq: 0, by: null, reason: 'foyer', waitingFor: [], countdown: false },
  seats: [{ userId: 'ana', status: 'ready', aheadS: 0, direct: true }, { userId: 'me', status: 'preparing', aheadS: 0, direct: true }],
  options: { controlLock: false, waitForStalled: true }, iceServers: [], createdAt: 0, heat: [], ...over,
})
const dispatch = (d: unknown) => handleCinemaDispatch(d as Dispatch)
const flush = () => new Promise((r) => setTimeout(r, 0))
const ops = () => sent.map((f) => f.op)

beforeEach(() => {
  resetCinema()
  useMedia.setState({ connection: { state: 'connected', channelId: CH }, e2ee: { state: 'off', epoch: null } } as never)
  sent.length = 0
  engine.swarms.length = 0
  engine.meshes.length = 0
  engine.caches = 0
  vi.clearAllMocks()
})

describe('gateway', () => {
  it('READY asks for the call\'s session (cinema_hello)', () => {
    dispatch({ t: 'READY', d: { cinema: true } })
    expect(sent).toContainEqual({ op: 'cinema_hello' })
    expect(useCinema.getState().enabled).toBe(true)
  })

  it('starting after READY already arrived (the shell mounts later) still shows the button and says hello', () => {
    sessionFlags.cinema = true
    const stop = startCinema()
    expect(useCinema.getState().enabled).toBe(true)
    expect(sent).toContainEqual({ op: 'cinema_hello' })
    stop()
    sessionFlags.cinema = false
  })

  it('READY without cinema:true (an older server) sends no cinema op and keeps the button off', () => {
    dispatch({ t: 'READY', d: {} })
    dispatch({ t: 'READY', d: { cinema: false } })
    expect(sent).toEqual([])
    expect(useCinema.getState().enabled).toBe(false)
  })

  it('CINEMA_STATE sets the session; seated → swarm and mesh, mesh synced before any signal', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    expect(useCinema.getState().session?.sessionId).toBe(SID)
    expect(useCinema.getState().mine.seated).toBe(true)
    dispatch({ t: 'CINEMA_SIGNAL', d: { sessionId: SID, from: 'ana', signal: { kind: 'ice', candidates: ['c'] } } })
    await flush()
    expect(engine.swarms).toHaveLength(1)
    expect(engine.meshes).toHaveLength(1)
    expect(engine.meshes[0].calls).toEqual(['sync', 'signal'])
  })

  it('a session I do not sit in has no engine', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view({ seats: [{ userId: 'ana', status: 'ready', aheadS: 0, direct: true }] }) })
    await flush()
    expect(useCinema.getState().session?.sessionId).toBe(SID)
    expect(useCinema.getState().mine.seated).toBe(false)
    expect(engine.swarms).toHaveLength(0)
  })

  it('viewers feed CINEMA_PIECES to the swarm index, also when they arrive before the cache is open', async () => {
    const item: CinemaPieceMeta = [-1, 0, 900, 'a'.repeat(64)]
    dispatch({ t: 'CINEMA_PIECES', d: { sessionId: SID, track: 'v', from: 0, items: [item] } }) // index replay comes before the state
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    dispatch({ t: 'CINEMA_PIECES', d: { sessionId: SID, track: 'v', from: 1, items: [item] } })
    expect(engine.swarms[0].setIndex.mock.calls).toEqual([['v', 0, [item]], ['v', 1, [item]]])
  })

  it('ended → session null and the summary kept; the engine closes', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    const summary = { watchedS: 1200, seats: ['ana', 'me'], reactions: 3, peak: null }
    dispatch({ t: 'CINEMA_STATE', d: { channelId: CH, sessionId: SID, ended: true, reason: 'host_ended', summary } })
    expect(useCinema.getState().session).toBeNull()
    expect(useCinema.getState().ended).toMatchObject({ title: 'Duna (2024)', reason: 'host_ended', summary })
    expect(engine.swarms[0].close).toHaveBeenCalled()
    expect(engine.meshes[0].close).toHaveBeenCalled()
  })

  it('a new READY while seated says hello again and keeps the same swarm (same cache) for the same session', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    sent.length = 0
    dispatch({ t: 'READY', d: { cinema: true } })
    expect(ops()).toContain('cinema_hello')
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: { ...view().playback, seq: 1 } }) })
    await flush()
    expect(engine.swarms).toHaveLength(1)
    expect(engine.caches).toBe(1)
    expect(engine.swarms[0].close).not.toHaveBeenCalled()
  })

  it('CINEMA_ERROR stale shows nothing and the state sent with it applies', () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_control', reason: 'stale', sessionId: SID } })
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: { ...view().playback, seq: 7, reason: 'user' } }) })
    expect(useCinema.getState().error).toBeNull()
    expect(useCinema.getState().session?.playback.seq).toBe(7)
  })

  it('CINEMA_ERROR disabled says the server has the cinema off', () => {
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_open', reason: 'disabled' } })
    expect(useCinema.getState().error).toBe('Cinema desligado neste servidor')
  })

  it('ignores a state for another channel', () => {
    dispatch({ t: 'CINEMA_STATE', d: view({ channelId: '0190a0a0-0000-7000-8000-0000000000ff' }) })
    expect(useCinema.getState().session).toBeNull()
  })
})

describe('host', () => {
  it('checkFfmpeg blocked → the clear antivirus message, nothing probed', async () => {
    bridge.checkFfmpeg.mockResolvedValueOnce({ ok: false, reason: 'blocked', detail: 'EPERM' })
    await openFromFile()
    expect(useCinema.getState().error).toBe(t.ffmpegBlocked)
    expect(bridge.probe).not.toHaveBeenCalled()
    expect(bridge.close).toHaveBeenCalledWith('f1')
  })

  it('pick → probe → sheet → open; the factory starts with the session; its index goes out merged, throttled, ≤ CINEMA_ITEMS_PER_FRAME per frame', async () => {
    vi.useFakeTimers()
    try {
      bridge.probe.mockResolvedValueOnce({ film, warnings: [], next: [] })
      await openFromFile()
      expect(useCinema.getState().draft?.film.title).toBe('Duna (2024)')
      openSession('Duna Parte Dois')
      expect(sent.at(-1)).toMatchObject({ op: 'cinema_open', channelId: CH, startS: 0, film: { title: 'Duna Parte Dois' } })
      expect(bridge.start).not.toHaveBeenCalled()
      dispatch({ t: 'CINEMA_STATE', d: view({ hostId: 'me', seats: [{ userId: 'me', status: 'preparing', aheadS: 0, direct: true }] }) })
      expect(bridge.start).toHaveBeenCalledWith('f1', 0, [0])
      await vi.advanceTimersByTimeAsync(0)
      const items = Array.from({ length: 250 }, (_, i): CinemaPieceMeta => [i * 4, 4, 1000, 'b'.repeat(64)])
      const frames = () => sent.filter((f) => f.op === 'cinema_pieces') as { track: string; from: number; items: unknown[] }[]
      sent.length = 0
      bridge.emitPieces!({ fileId: 'f1', track: 'v', from: 0, items })
      expect(engine.swarms[0].setIndex).toHaveBeenCalledWith('v', 0, items) // the host's own swarm: at once
      await vi.advanceTimersByTimeAsync(0) // first batch: right away
      expect(frames().map((f) => [f.from, f.items.length])).toEqual([[0, CINEMA_ITEMS_PER_FRAME], [CINEMA_ITEMS_PER_FRAME, CINEMA_ITEMS_PER_FRAME], [240, 10]])
      // the factory reports every 250 ms per track: those wait for the interval and go as one frame per track
      sent.length = 0
      for (let n = 250; n < 258; n++) bridge.emitPieces!({ fileId: 'f1', track: 'v', from: n, items: [items[0]!] })
      bridge.emitPieces!({ fileId: 'f1', track: 'a0', from: 0, items: [items[0]!, items[1]!] })
      await vi.advanceTimersByTimeAsync(1000)
      expect(frames()).toEqual([])
      await vi.advanceTimersByTimeAsync(1100)
      expect(frames().map((f) => [f.track, f.from, f.items.length]).sort()).toEqual([['a0', 0, 2], ['v', 250, 8]])
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---- fix round 1 ------------------------------------------------------------------------------------------------------

const hostView = (over: Partial<CinemaSessionView> = {}) => view({ hostId: 'me', seats: [{ userId: 'me', status: 'preparing', aheadS: 0, direct: true }], ...over })
const meta = (i: number): CinemaPieceMeta => [i * 4, 4, 1000, 'c'.repeat(64)]
const pieceFrames = () => sent.filter((f) => f.op === 'cinema_pieces') as { track: string; from: number; items: CinemaPieceMeta[] }[]
/** The host's file is open and its session confirmed (the factory started). */
async function hosting(): Promise<void> {
  bridge.probe.mockResolvedValueOnce({ film, warnings: [], next: [] })
  await openFromFile()
  openSession('Duna')
  dispatch({ t: 'CINEMA_STATE', d: hostView() })
  await vi.advanceTimersByTimeAsync(0)
}

describe('index budget and repair (host)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('8 tracks producing every 250 ms: at most 120 cinema_pieces frames per minute in all, never a gap (server rule from <= length)', async () => {
    await hosting()
    const tracks = ['v', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']
    const made = new Map(tracks.map((tr) => [tr, 0]))
    const server = new Map<string, number>()
    const apply = (f: { track: string; from: number; items: unknown[] }) => {
      const len = server.get(f.track) ?? 0
      expect(f.from).toBeLessThanOrEqual(len) // else the server answers `invalid`
      server.set(f.track, Math.max(len, f.from + f.items.length))
    }
    sent.length = 0
    for (let ms = 0; ms < 60_000; ms += 250) {
      for (const tr of tracks) {
        const n = made.get(tr)!
        bridge.emitPieces!({ fileId: 'f1', track: tr, from: n, items: [meta(n)] })
        made.set(tr, n + 1)
      }
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(pieceFrames().length).toBeLessThanOrEqual(120)
    pieceFrames().forEach(apply)
    sent.length = 0
    await vi.advanceTimersByTimeAsync(120_000) // the backlog drains through the same budget
    pieceFrames().forEach(apply)
    for (const tr of tracks) expect(server.get(tr)).toBe(made.get(tr))
  })

  it('the video and the default audio go first: a0 is in the next flush even behind five other pending tracks', async () => {
    await hosting()
    bridge.emitPieces!({ fileId: 'f1', track: 'v', from: 0, items: [meta(0), meta(1)] })
    await vi.advanceTimersByTimeAsync(2000)
    sent.length = 0
    for (const tr of ['a1', 's0', 's1', 'poster', 'thumbs']) bridge.emitPieces!({ fileId: 'f1', track: tr, from: 0, items: [meta(0)] })
    bridge.emitPieces!({ fileId: 'f1', track: 'v', from: 2, items: [meta(2)] })
    bridge.emitPieces!({ fileId: 'f1', track: 'a0', from: 0, items: [meta(0)] })
    await vi.advanceTimersByTimeAsync(0) // the interval since the last flush has passed: this one goes at once
    // a0 has shipped nothing yet, v two entries; then the extras, fewest shipped first
    expect(pieceFrames().map((f) => f.track)).toEqual(['a0', 'v', 'a1'])
    sent.length = 0
    await vi.advanceTimersByTimeAsync(2000)
    expect(pieceFrames().map((f) => f.track)).toEqual(['s0', 's1', 'poster'])
  })

  it('a new gateway session resends the whole index once the session is confirmed; a refused (invalid) frame too, not in a loop', async () => {
    await hosting()
    bridge.emitPieces!({ fileId: 'f1', track: 'v', from: 0, items: [meta(0), meta(1), meta(2)] })
    await vi.advanceTimersByTimeAsync(2000)
    bridge.emitPieces!({ fileId: 'f1', track: 'v', from: 3, items: [meta(3)] }) // accepted by send(), lost with the socket
    await vi.advanceTimersByTimeAsync(2000)
    sent.length = 0
    dispatch({ t: 'READY', d: { cinema: true } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(pieceFrames()).toEqual([]) // not before the session is confirmed
    dispatch({ t: 'CINEMA_STATE', d: hostView({ playback: { ...view().playback, seq: 3 } }) })
    await vi.advanceTimersByTimeAsync(2000)
    expect(pieceFrames().map((f) => [f.track, f.from, f.items.length])).toEqual([['v', 0, 4]])
    sent.length = 0
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_pieces', reason: 'invalid', sessionId: SID } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(pieceFrames()).toEqual([]) // repaired a moment ago
    await vi.advanceTimersByTimeAsync(30_000)
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_pieces', reason: 'invalid', sessionId: SID } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(pieceFrames().map((f) => [f.track, f.from, f.items.length])).toEqual([['v', 0, 4]])
    expect(useCinema.getState().error).toBeNull()
  })
})

describe('session gone while the gateway was down', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('hello answered not_found: session, engine and the host factory go, busy cleared, no error shown', async () => {
    await hosting()
    dispatch({ t: 'READY', d: { cinema: true } })
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_hello', reason: 'not_found' } })
    expect(useCinema.getState()).toMatchObject({ session: null, busy: false, error: null, mine: { seated: false } })
    expect(engine.swarms[0].close).toHaveBeenCalled()
    expect(bridge.close).toHaveBeenCalledWith('f1')
  })

  it('an older server that answers nothing: dropped 5 s after hello', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await vi.advanceTimersByTimeAsync(0)
    dispatch({ t: 'READY', d: { cinema: true } })
    await vi.advanceTimersByTimeAsync(4000)
    expect(useCinema.getState().session).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1500)
    expect(useCinema.getState().session).toBeNull()
    expect(engine.swarms[0].close).toHaveBeenCalled()
  })

  it('a slow server (no state 5 s after hello) never costs the host its film: the file stays, and serves again when the state comes', async () => {
    await hosting()
    dispatch({ t: 'READY', d: { cinema: true } })
    await vi.advanceTimersByTimeAsync(6000)
    expect(useCinema.getState().session).toBeNull()
    expect(engine.swarms[0].close).toHaveBeenCalled()
    expect(bridge.close).not.toHaveBeenCalled()
    expect(useCinema.getState().host.fileId).toBe('f1')
    dispatch({ t: 'CINEMA_STATE', d: hostView({ playback: { ...view().playback, seq: 2 } }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.swarms).toHaveLength(2)
    expect((engine.swarms[1].opts as { source?: unknown }).source).toBeTypeOf('function')
    expect(bridge.start).toHaveBeenCalledTimes(1) // the same factory, not a new one
    // the session really ended meanwhile: now the file goes
    dispatch({ t: 'CINEMA_STATE', d: { channelId: CH, sessionId: SID, ended: true, reason: 'host_ended', summary: { watchedS: 0, seats: [], reactions: 0, peak: null } } })
    expect(bridge.close).toHaveBeenCalledWith('f1')
  })

  it('an open still on its way survives a not_found hello', async () => {
    bridge.probe.mockResolvedValueOnce({ film, warnings: [], next: [] })
    await openFromFile()
    openSession('Duna')
    dispatch({ t: 'CINEMA_ERROR', d: { op: 'cinema_hello', reason: 'not_found' } })
    expect(bridge.close).not.toHaveBeenCalled()
    dispatch({ t: 'CINEMA_STATE', d: hostView() })
    expect(bridge.start).toHaveBeenCalledWith('f1', 0, [0])
  })
})

describe('media drop (host)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const conn = (state: string, channelId: string | null = CH) => ({ state, channelId })

  it('a media disconnect keeps the file; back in the call the new host swarm serves from it again; leaving closes it', async () => {
    await hosting()
    useMedia.setState({ connection: conn('disconnected') } as never)
    onMediaChange(conn('disconnected'), conn('connected'))
    expect(bridge.close).not.toHaveBeenCalled()
    expect(engine.swarms[0].close).toHaveBeenCalled() // the seat's engine stops meanwhile
    useMedia.setState({ connection: conn('connected') } as never)
    onMediaChange(conn('connected'), conn('connecting'))
    expect(sent.at(-1)).toEqual({ op: 'cinema_hello' })
    dispatch({ t: 'CINEMA_STATE', d: hostView({ playback: { ...view().playback, seq: 2, reason: 'user' } }) }) // hostBack re-seats me
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.swarms).toHaveLength(2)
    expect((engine.swarms[1].opts as { source?: unknown }).source).toBeTypeOf('function')
    onMediaChange(conn('idle', null), conn('connected'))
    expect(bridge.close).toHaveBeenCalledWith('f1')
  })

  it('still dropped after CINEMA_HOST_AWAY_MS: the file closes', async () => {
    await hosting()
    useMedia.setState({ connection: conn('disconnected') } as never)
    onMediaChange(conn('disconnected'), conn('connected'))
    await vi.advanceTimersByTimeAsync(CINEMA_HOST_AWAY_MS - 1000)
    expect(bridge.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(bridge.close).toHaveBeenCalledWith('f1')
    expect(useCinema.getState().session).toBeNull()
  })

  it('leaving the call with the film sheet open closes its file', async () => {
    bridge.probe.mockResolvedValueOnce({ film, warnings: [], next: [] })
    await openFromFile()
    onMediaChange(conn('idle', null), conn('connected'))
    expect(useCinema.getState().draft).toBeNull()
    expect(bridge.close).toHaveBeenCalledWith('f1')
  })
})

describe('E2EE gating of the mesh', () => {
  it('establishing: no mesh, signals wait; active: a tagged mesh, synced before the buffered signal', async () => {
    useMedia.setState({ e2ee: { state: 'establishing', epoch: null } } as never)
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    dispatch({ t: 'CINEMA_SIGNAL', d: { sessionId: SID, from: 'ana', signal: { kind: 'ice', candidates: ['c'] } } })
    expect(engine.swarms).toHaveLength(1)
    expect(engine.meshes).toHaveLength(0)
    useMedia.setState({ e2ee: { state: 'active', epoch: 7 } } as never)
    expect(engine.meshes).toHaveLength(1)
    expect((engine.meshes[0].opts as { e2ee: { epoch(): number } | null }).e2ee?.epoch()).toBe(7)
    expect(engine.meshes[0].calls).toEqual(['sync', 'signal'])
  })

  it('establishing then failed: never a mesh (an untagged one would trust the server)', async () => {
    useMedia.setState({ e2ee: { state: 'establishing', epoch: null } } as never)
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    useMedia.setState({ e2ee: { state: 'failed', epoch: null } } as never)
    useMedia.setState({ e2ee: { state: 'off', epoch: null } } as never)
    expect(engine.meshes).toHaveLength(0)
  })

  it('failed while seated: the notice in pt-BR, never a mesh, and the seat stays preparing even with pieces ahead', async () => {
    vi.useFakeTimers()
    try {
      useMedia.setState({ e2ee: { state: 'establishing', epoch: null } } as never)
      dispatch({ t: 'CINEMA_STATE', d: view() })
      await vi.advanceTimersByTimeAsync(0)
      engine.swarms[0].aheadS = () => 60 // a host serving from its own file would be ready
      useMedia.setState({ e2ee: { state: 'failed', epoch: null } } as never)
      useMedia.setState({ e2ee: { state: 'off', epoch: null } } as never)
      sent.length = 0
      await vi.advanceTimersByTimeAsync(2500)
      expect(useCinema.getState().notices).toEqual(['Não foi possível proteger a conexão desta sessão'])
      expect(engine.meshes).toHaveLength(0)
      expect(useCinema.getState().mine.status).toBe('preparing')
      const statuses = sent.filter((f) => f.op === 'cinema_status').map((f) => f.status)
      expect(statuses.length).toBeGreaterThan(0)
      expect(new Set(statuses)).toEqual(new Set(['preparing']))
    } finally {
      vi.useRealTimers()
    }
  })

  it('failed after a tagged mesh: the notice, no second mesh, preparing', async () => {
    vi.useFakeTimers()
    try {
      useMedia.setState({ e2ee: { state: 'active', epoch: 3 } } as never)
      dispatch({ t: 'CINEMA_STATE', d: view() })
      await vi.advanceTimersByTimeAsync(0)
      expect(engine.meshes).toHaveLength(1)
      engine.swarms[0].aheadS = () => 60
      useMedia.setState({ e2ee: { state: 'failed', epoch: null } } as never)
      await vi.advanceTimersByTimeAsync(2500)
      expect(useCinema.getState().notices).toContain(t.e2eeFailed)
      expect(engine.meshes).toHaveLength(1)
      expect(useCinema.getState().mine.status).toBe('preparing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('off from the start: an untagged mesh', async () => {
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await flush()
    expect((engine.meshes[0].opts as { e2ee: unknown }).e2ee).toBeNull()
  })
})

describe('late join (sat into a room already playing)', () => {
  const el = { currentTime: 30 } as HTMLVideoElement
  const lastStatus = () => (sent.filter((f) => f.op === 'cinema_status').at(-1) as { status?: string } | undefined)?.status
  const playing = () => ({ ...view().playback, playing: true, reason: 'user' as const, at: Date.now() - 60_000, position: 0, seq: 3 })
  beforeEach(() => {
    vi.useFakeTimers()
    players.list.length = 0
  })
  afterEach(() => {
    detachVideo(el)
    vi.useRealTimers()
  })

  it('a stall in its first CINEMA_READY_TIMEOUT_MS reports preparing (the room does not pause for everyone); later, stalled', async () => {
    attachVideo(el)
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: playing() }) })
    await vi.advanceTimersByTimeAsync(0)
    const s = engine.swarms.at(-1)
    s.aheadS = () => 40 // it gets there in time: ready once
    await vi.advanceTimersByTimeAsync(600)
    expect(lastStatus()).toBe('ready')
    players.list.at(-1).stall(true)
    expect(lastStatus()).toBe('preparing')
    await vi.advanceTimersByTimeAsync(CINEMA_READY_TIMEOUT_MS + 1000)
    expect(lastStatus()).toBe('stalled')
  })

  it('still loading when CINEMA_READY_TIMEOUT_MS ends: its stalls stay preparing until it has been ready once (measured: a 0.6 s room pause at 11.8 s)', async () => {
    attachVideo(el)
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: playing() }) })
    await vi.advanceTimersByTimeAsync(0)
    const s = engine.swarms.at(-1)
    s.aheadS = () => 5
    s.recvMbps = () => 4 // poor network: ready needs 30 s
    await vi.advanceTimersByTimeAsync(CINEMA_READY_TIMEOUT_MS + 1000)
    players.list.at(-1).stall(true)
    expect(lastStatus()).toBe('preparing')
    players.list.at(-1).stall(false)
    s.aheadS = () => 30
    await vi.advanceTimersByTimeAsync(600)
    expect(lastStatus()).toBe('ready')
    s.aheadS = () => 0
    players.list.at(-1).stall(true)
    expect(lastStatus()).toBe('stalled')
  })

  it('a seat that was there when the room started pauses it on a stall at once', async () => {
    attachVideo(el)
    dispatch({ t: 'CINEMA_STATE', d: view() }) // foyer
    await vi.advanceTimersByTimeAsync(0)
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: playing() }) })
    players.list.at(-1).stall(true)
    expect(lastStatus()).toBe('stalled')
  })
})

describe('adaptive pre-roll (poor networks start later instead of stalling again and again)', () => {
  const base = { isHost: false, bitrateKbps: 8000, afterStall: false, leftS: 600 }
  it('readyAheadS: 3 s on a good network; 30 s below 1.1× the bitrate or before any measure; 60 s after a stall', () => {
    expect(readyAheadS({ ...base, recvMbps: 8.8 })).toBe(CINEMA_SEEK_READY_S)
    expect(readyAheadS({ ...base, recvMbps: 8.7 })).toBe(30)
    expect(readyAheadS({ ...base, recvMbps: null })).toBe(30)
    expect(readyAheadS({ ...base, recvMbps: 5, afterStall: true })).toBe(60)
    expect(readyAheadS({ ...base, recvMbps: 50, afterStall: true })).toBe(CINEMA_SEEK_READY_S)
  })
  it('readyAheadS: the host is the source (3 s); never more than what is left of the film', () => {
    expect(readyAheadS({ ...base, isHost: true, recvMbps: null, afterStall: true })).toBe(CINEMA_SEEK_READY_S)
    expect(readyAheadS({ ...base, recvMbps: 1, leftS: 12 })).toBe(12)
    expect(readyAheadS({ ...base, recvMbps: 1, leftS: -1 })).toBe(0)
  })

  const el = { currentTime: 100 } as HTMLVideoElement
  const lastStatus = () => (sent.filter((f) => f.op === 'cinema_status').at(-1) as { status?: string } | undefined)?.status
  const seated = async (ahead: number, mbps: number | null) => {
    attachVideo(el)
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await vi.advanceTimersByTimeAsync(0)
    const s = engine.swarms.at(-1)
    s.aheadS = () => ahead
    s.recvMbps = () => mbps
    return s
  }
  beforeEach(() => {
    vi.useFakeTimers()
    players.list.length = 0
  })
  afterEach(() => {
    detachVideo(el)
    vi.useRealTimers()
  })

  it('poor network: preparing with 20 s ahead, ready at 30 s; a good one is ready at 3 s', async () => {
    const s = await seated(20, 4)
    await vi.advanceTimersByTimeAsync(2500)
    expect(lastStatus()).toBe('preparing')
    s.aheadS = () => 30
    await vi.advanceTimersByTimeAsync(600)
    expect(lastStatus()).toBe('ready')
    resetCinema()
    sent.length = 0
    await seated(3, 40)
    await vi.advanceTimersByTimeAsync(600)
    expect(lastStatus()).toBe('ready')
  })

  it('after a stall on a poor network: stays stalled until 60 s ahead (the swarm fetches 60 s as critical), then ready', async () => {
    const s = await seated(12, 4)
    const player = players.list.at(-1)
    dispatch({ t: 'CINEMA_STATE', d: view({ playback: { ...view().playback, playing: true, reason: 'user', at: Date.now(), seq: 2 } }) })
    player.stall(true)
    expect(lastStatus()).toBe('stalled')
    player.stall(false) // the player holds CINEMA_RESUME_AHEAD_S again
    s.aheadS = () => 40
    await vi.advanceTimersByTimeAsync(2500)
    expect(lastStatus()).toBe('stalled')
    expect(s.setCriticalS).toHaveBeenLastCalledWith(60)
    s.aheadS = () => 60
    await vi.advanceTimersByTimeAsync(600)
    expect(lastStatus()).toBe('ready')
    expect(s.setCriticalS).toHaveBeenLastCalledWith(30)
  })
})

describe('room extras (poster, thumbnails)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a seat fetches the poster from the start and the thumbnails once it has been ready; extraPiece reads them from the swarm', async () => {
    expect(await extraPiece('poster')).toBeNull() // no engine
    dispatch({ t: 'CINEMA_STATE', d: view() })
    await vi.advanceTimersByTimeAsync(0)
    const s = engine.swarms.at(-1)
    expect(s.setTracks.mock.calls.at(-1)[0]).toEqual(['v', 'a0', 'poster'])
    s.aheadS = () => 40
    await vi.advanceTimersByTimeAsync(600)
    expect(s.setTracks.mock.calls.at(-1)[0]).toEqual(['v', 'a0', 'poster', 'thumbs'])
    const bytes = new ArrayBuffer(4)
    s.get = vi.fn(async () => bytes)
    expect(await extraPiece('thumbs')).toBe(bytes)
    expect(s.get).toHaveBeenCalledWith('thumbs', 0)
  })
})
