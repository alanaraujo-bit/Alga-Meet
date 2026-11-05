import type { CinemaPieceMeta, CinemaSessionView, Dispatch } from '@alga/shared'
import { CINEMA_ITEMS_PER_FRAME } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CH = '0190a0a0-0000-7000-8000-00000000c0c0'
const SID = '0190a0a0-0000-7000-8000-000000005e55'

// ---- fakes: gateway, media/data stores, engine pieces and the main bridge -----------------------------------------------
const sent: Record<string, unknown>[] = []
vi.mock('@/store/session', () => ({
  onDispatch: () => () => undefined,
  useSession: { getState: () => ({ send: (f: Record<string, unknown>) => (sent.push(f), true) }) },
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
    aheadS = () => 0
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
    onChannel = () => () => undefined
    onPeerGone = () => () => undefined
    relayed = () => []
    close = vi.fn()
    constructor(readonly opts: unknown) {
      engine.meshes.push(this)
    }
  },
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

const { handleCinemaDispatch, useCinema, resetCinema } = await import('./store')
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
  options: { controlLock: false, waitForStalled: true }, iceServers: [], createdAt: 0, ...over,
})
const dispatch = (d: unknown) => handleCinemaDispatch(d as Dispatch)
const flush = () => new Promise((r) => setTimeout(r, 0))
const ops = () => sent.map((f) => f.op)

beforeEach(() => {
  resetCinema()
  sent.length = 0
  engine.swarms.length = 0
  engine.meshes.length = 0
  engine.caches = 0
  vi.clearAllMocks()
})

describe('gateway', () => {
  it('READY asks for the call\'s session (cinema_hello)', () => {
    dispatch({ t: 'READY', d: {} })
    expect(sent).toContainEqual({ op: 'cinema_hello' })
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
    dispatch({ t: 'READY', d: {} })
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
      expect(frames().map((f) => [f.track, f.from, f.items.length])).toEqual([['v', 250, 8], ['a0', 0, 2]])
    } finally {
      vi.useRealTimers()
    }
  })
})
