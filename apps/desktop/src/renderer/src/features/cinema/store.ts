// Sala de Cinema, client side (spec §6): the session as the gateway reports it (CINEMA_*), and while I sit, the engine —
// clock, swarm, mesh, player, film audio — wired together. The dev stage (CinemaDev) renders this; Plan 2 swaps the UI.
import {
  CINEMA_ITEMS_PER_FRAME, CINEMA_SEEK_READY_S, CINEMA_STATUS_INTERVAL_MS, positionAt,
  type CinemaClientFrame, type CinemaEndReason, type CinemaFilm, type CinemaPieceMeta, type CinemaSeat, type CinemaSessionView,
  type CinemaSignal, type CinemaSummary, type CinemaTrackId, type Dispatch, type DispatchOf,
} from '@alga/shared'
import { create } from 'zustand'
import { useMedia } from '@/media/store'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { FilmAudio } from './audio'
import { ClockEstimator } from './clock'
import { Mesh } from './mesh'
import { CinemaPlayer, canPlay } from './player'
import { t } from './strings'
import { parseManifest, parseVtt, type Cue } from './subtitles'
import { clearStaleOpfs, createPieceCache } from './swarm/cache'
import { Swarm } from './swarm/swarm'

type Status = CinemaSeat['status']
type Warning = 'dv_profile5' | 'high_bitrate' | 'pgs_ignored' | 'audio_converted' | 'atmos_dropped' | 'tracks_truncated'

export interface CinemaState {
  session: CinemaSessionView | null
  /** The last session of this call that ended (summary card). */
  ended: { title: string; reason: CinemaEndReason; summary: CinemaSummary } | null
  mine: { seated: boolean; status: Status; audioId: number | null; subtitleId: number | null; offsetS: number; unsupported: string | null }
  /** The file I project (fileId only: the path never leaves main). */
  host: { fileId: string | null }
  /** Film sheet between probe and "Abrir sessão" (host). */
  draft: { fileId: string; name: string; film: CinemaFilm; warnings: Warning[]; decodes: boolean } | null
  subtitle: { id: number; format: 'vtt' | 'ass'; text: string; cues: Cue[]; fonts: Uint8Array[] } | null
  /** Which piece cache the swarm got (shown in the stats panel). */
  cache: { kind: 'opfs' | 'memory'; capBytes: number } | null
  /** The <video>'s film audio (volume, ducking, output), once the stage is mounted. */
  audio: FilmAudio | null
  prefs: { volume: number; muted: boolean; ducking: boolean }
  stats: CinemaStats | null
  statsOpen: boolean
  /** One-time notices (IP on sitting, headphones), each dismissed on its own. */
  notices: string[]
  error: string | null
  busy: boolean
}

export interface CinemaStats {
  cache: { kind: string; capGB: number } | null
  clock: { offsetMs: number | null; rttMs: number | null }
  swarm: ReturnType<Swarm['stats']> | null
  player: ReturnType<CinemaPlayer['stats']> | null
  relayed: string[]
  /** Video position − the room's position at the same instant (ms; + = ahead). */
  driftMs: number | null
  roomS: number
  videoS: number | null
  audioTrack: string | null
}

const PREFS_KEY = 'alga.cinema.v1'
type Stored = { volume?: number; muted?: boolean; ducking?: boolean; ipSeen?: boolean; echoSeen?: boolean }
const stored = (): Stored => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Stored
  } catch {
    return {}
  }
}
const store = (patch: Stored): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...stored(), ...patch }))
  } catch {
    // private mode / tests: prefs are per run
  }
}
const initialPrefs = (): CinemaState['prefs'] => {
  const s = stored()
  return { volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 1, muted: s.muted === true, ducking: s.ducking !== false }
}
const freshMine = (): CinemaState['mine'] => ({ seated: false, status: 'preparing', audioId: null, subtitleId: null, offsetS: 0, unsupported: null })
const initial = (): CinemaState => ({
  session: null, ended: null, mine: freshMine(), host: { fileId: null }, draft: null, subtitle: null, cache: null, audio: null,
  prefs: initialPrefs(), stats: null, statsOpen: false, notices: [], error: null, busy: false,
})

export const useCinema = create<CinemaState>(initial)

// ---- plumbing ---------------------------------------------------------------------------------------------------------

export const send = (f: CinemaClientFrame): boolean => useSession.getState().send(f)
const meId = (): string | undefined => useData.getState().me?.id
/** My call's channel while I am in one. */
export const callChannel = (): string | null => {
  const c = useMedia.getState().connection
  return c.state === 'idle' || c.state === 'disconnected' ? null : c.channelId
}
const GiB = 1024 ** 3
/** Cache budget: half of what the origin may store, at most 8 GiB (spec §6.5: ≥ 10 min ahead at 40 Mbps ≈ 3 GB). */
async function capBytes(): Promise<number> {
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  return Math.min(est?.quota ? est.quota * 0.5 : 4 * GiB, 8 * GiB)
}

// ---- the engine while I sit -------------------------------------------------------------------------------------------

interface Engine {
  sessionId: string
  hostId: string
  isHost: boolean
  film: CinemaFilm
  swarm: Swarm | null
  mesh: Mesh | null
  player: CinemaPlayer | null
  /** Before the cache is open: index frames and signals, replayed in order once it is. */
  early: Array<['pieces', CinemaTrackId, number, CinemaPieceMeta[]] | ['signal', string, CinemaSignal]>
  offs: Array<() => void>
  timer: ReturnType<typeof setInterval>
  stalled: boolean
  unsupported: boolean
  checked: boolean
  /** Audio track the player could not switch to yet (its init is still on the way). */
  pendingAudio: number | null
  sentStatus: Status | null
  sentAt: number
  closed: boolean
}

let eng: Engine | null = null
let video: HTMLVideoElement | null = null
const clock = new ClockEstimator()
let pingTimer: ReturnType<typeof setTimeout> | undefined
let rttMs: number | null = null
/** Index frames for a session I have not sat in yet (the server replays the index right before the seat's first state). */
let earlyPieces: { sessionId: string; frames: [CinemaTrackId, number, CinemaPieceMeta[]][] } | null = null
const MAX_EARLY_FRAMES = 1000

/** The file I project: its piece index accumulates here (the server never sends the host its own index back). */
interface HostFile {
  fileId: string; film: CinemaFilm; sessionId: string | null; index: Map<CinemaTrackId, CinemaPieceMeta[]>; offs: Array<() => void>
  /** Playback seq and position the factory last followed. */
  seq: number; pos: number
  /** Index entries not sent to the server yet (n → meta per track), and the throttle of queuePieces. */
  pending: Map<CinemaTrackId, Map<number, CinemaPieceMeta>>; flushTimer: ReturnType<typeof setTimeout> | undefined; flushedAt: number
}
let hostFile: HostFile | null = null

const audioTrack = (id: number | null): CinemaTrackId[] => (id === null ? [] : [`a${id}`])
const subTrack = (id: number | null): CinemaTrackId[] => (id === null ? [] : [`s${id}`])
/** What this seat downloads: video, its audio track (and the one it is switching to), its subtitle. */
function syncTracks(e: Engine): void {
  const m = useCinema.getState().mine
  e.swarm?.setTracks(['v', ...audioTrack(m.audioId), ...(e.pendingAudio !== null && e.pendingAudio !== m.audioId ? audioTrack(e.pendingAudio) : []), ...subTrack(m.subtitleId)])
}

/** Where the room is now (film seconds, server clock). */
function roomPos(): number {
  const s = useCinema.getState().session
  return s ? positionAt(s.playback, clock.serverNow(), s.film.durationS) : 0
}

function createEngine(v: CinemaSessionView): void {
  const isHost = v.hostId === meId()
  const e: Engine = {
    sessionId: v.sessionId, hostId: v.hostId, isHost, film: v.film, swarm: null, mesh: null, player: null, early: [], offs: [],
    timer: setInterval(() => tick(e), 500), stalled: false, unsupported: false, checked: false, pendingAudio: null, sentStatus: null,
    sentAt: 0, closed: false,
  }
  eng = e
  const def = v.film.audio.find((a) => a.default) ?? v.film.audio[0]
  useCinema.setState((s) => ({ mine: { ...s.mine, audioId: s.mine.audioId ?? def?.id ?? null, status: 'preparing', unsupported: null } }))
  if (earlyPieces?.sessionId === v.sessionId) for (const [track, from, items] of earlyPieces.frames) e.early.push(['pieces', track, from, items])
  earlyPieces = null
  void (async () => {
    const cap = await capBytes()
    const c = await createPieceCache(v.sessionId, cap)
    if (e.closed) return void c.cache.clear()
    useCinema.setState({ cache: { kind: c.kind, capBytes: c.capBytes } })
    const fileId = isHost ? hostFile?.fileId : undefined
    const swarm = new Swarm({
      sessionId: v.sessionId, isHost, cache: c.cache, hostId: v.hostId, capBytes: c.capBytes,
      ...(fileId ? { source: (track: CinemaTrackId, n: number) => window.alga.cinema.piece(fileId, track, n) } : {}),
    })
    e.swarm = swarm
    syncTracks(e)
    swarm.setPlayhead(roomPos())
    if (isHost && hostFile) for (const [track, list] of hostFile.index) swarm.setIndex(track, 0, list)
    e.offs.push(swarm.onPiece((track, n) => onPiece(e, track, n)))
    const media = useMedia.getState().e2ee
    const mesh = new Mesh({
      sessionId: v.sessionId, channelId: v.channelId, selfId: meId() ?? '', iceServers: useCinema.getState().session?.iceServers ?? v.iceServers,
      // the MLS epoch changes on every join/leave: read it when a description is sent
      e2ee: media.state === 'active' ? { epoch: () => useMedia.getState().e2ee.epoch ?? 0 } : null,
      send,
    })
    e.mesh = mesh
    e.offs.push(
      mesh.onChannel((peer, ch) => swarm.addPeer(peer, ch)),
      mesh.onPeerGone((peer) => swarm.removePeer(peer)),
    )
    // seats first: the mesh only takes signals from peers it wants
    mesh.sync(useCinema.getState().session?.seats ?? v.seats)
    for (const x of e.early.splice(0)) {
      if (x[0] === 'pieces') swarm.setIndex(x[1], x[2], x[3])
      else void mesh.onSignal(x[1], x[2])
    }
    attachPlayer(e)
    pushStatus(e)
  })()
}

function closeEngine(): void {
  const e = eng
  eng = null
  if (!e) return
  e.closed = true
  clearInterval(e.timer)
  for (const off of e.offs.splice(0)) off()
  e.mesh?.close()
  e.player?.destroy()
  void e.swarm?.close()
  useCinema.setState((s) => ({ cache: null, subtitle: null, stats: null, mine: { ...freshMine(), offsetS: s.mine.offsetS } }))
}

function attachPlayer(e: Engine): void {
  const s = useCinema.getState()
  if (e.closed || e.player || !e.swarm || !video) return
  const audio = s.audio
  const player = new CinemaPlayer(video, e.swarm, e.film, audio ? { outputLatencyMs: audio.outputLatencyMs } : {})
  e.player = player
  e.offs.push(
    player.onStall((stalled) => {
      e.stalled = stalled
      pushStatus(e)
    }),
    player.onError(() => {
      if (e.unsupported) return
      e.unsupported = true
      useCinema.setState((st) => ({ mine: { ...st.mine, unsupported: t.playerFailed } }))
      pushStatus(e)
    }),
  )
  // Both SourceBuffers must exist before the first append: the audio track goes in before feeding starts.
  const id = s.mine.audioId
  if (id !== null) switchAudio(e, id)
  applyPlayback()
}

/** Player switches to audio `id`; while its init is not downloaded yet, the swarm fetches it and onPiece retries. */
function switchAudio(e: Engine, id: number): void {
  e.pendingAudio = id
  syncTracks(e)
  e.player?.setAudio(id).then(
    () => {
      if (e.pendingAudio !== id) return
      e.pendingAudio = null
      syncTracks(e)
    },
    () => undefined, // init not held yet: onPiece(a<id>, 0) tries again
  )
}

function onPiece(e: Engine, track: CinemaTrackId, n: number): void {
  if (e.closed) return
  if (n === 0 && e.pendingAudio !== null && track === `a${e.pendingAudio}`) switchAudio(e, e.pendingAudio)
  const sub = useCinema.getState().mine.subtitleId
  if (sub !== null && track === `s${sub}` && useCinema.getState().subtitle?.id !== sub) void loadSubtitle(e, sub)
  pushStatus(e)
}

/** Takes the room's timeline (never before the first clock sample: a guessed clock would schedule wrong). */
function applyPlayback(): void {
  const s = useCinema.getState().session
  if (!s || !eng?.player || !clock.hasSample()) return
  eng.player.apply(s.playback, () => clock.serverNow())
}

/** Where my seat plays now: the video, or the room before the video is up. */
const playheadS = (e: Engine): number => (e.player && video ? video.currentTime : roomPos())

function aheadS(e: Engine): number {
  const s = e.swarm
  if (!s) return 0
  const m = useCinema.getState().mine
  return Math.min(s.aheadS('v'), ...audioTrack(m.audioId).map((tr) => s.aheadS(tr)))
}

function statusNow(e: Engine): Status {
  if (e.unsupported) return 'unsupported'
  if (e.stalled) return 'stalled'
  const pos = playheadS(e)
  const need = Math.max(0, Math.min(CINEMA_SEEK_READY_S, e.film.durationS - pos - 0.5))
  if (aheadS(e) >= need) return 'ready'
  // ready stays ready while playing; a start/seek resets the seat to preparing on the server, and then we follow
  const seat = useCinema.getState().session?.seats.find((x) => x.userId === meId())
  return seat?.status === 'ready' && e.sentStatus === 'ready' ? 'ready' : 'preparing'
}

/** cinema_status on a change at once, else every CINEMA_STATUS_INTERVAL_MS (aheadS refresh). */
function pushStatus(e: Engine): void {
  if (e.closed || !e.swarm) return
  const status = statusNow(e)
  const now = Date.now()
  if (status === e.sentStatus && now - e.sentAt < CINEMA_STATUS_INTERVAL_MS) return
  const ahead = Math.max(0, Math.round(aheadS(e) * 10) / 10)
  if (!send({ op: 'cinema_status', sessionId: e.sessionId, status, aheadS: ahead })) return
  e.sentStatus = status
  e.sentAt = now
  if (useCinema.getState().mine.status !== status) useCinema.setState((s) => ({ mine: { ...s.mine, status } }))
}

function tick(e: Engine): void {
  if (e.closed || !e.swarm) return
  if (!e.player) e.swarm.setPlayhead(roomPos())
  // Decode check (spec §6.5) once the playhead's first pieces are here (before that only the type check would run).
  const audioId = useCinema.getState().mine.audioId
  if (!e.checked && aheadS(e) > 0) {
    e.checked = true
    void canPlay(e.film, audioId ?? -1, e.swarm).then((r) => {
      if (r.ok || e.closed) return
      e.unsupported = true
      useCinema.setState((s) => ({ mine: { ...s.mine, unsupported: t.unsupported[r.reason] ?? t.playerFailed } }))
      pushStatus(e)
    }, (err: unknown) => console.warn('[cinema] decode check', err))
  }
  // The host's factory follows the room (pieces behind it may go for the disk budget).
  if (e.isHost && hostFile?.sessionId === e.sessionId) window.alga.cinema.setPlayhead(hostFile.fileId, Math.max(0, playheadS(e)))
  pushStatus(e)
  if (useCinema.getState().statsOpen) useCinema.setState({ stats: cinemaStats() })
}

// ---- subtitles ----------------------------------------------------------------------------------------------------------

/** s<id>: piece 0 is the manifest, pieces 1..k its fonts (R27); loads once everything is held. */
async function loadSubtitle(e: Engine, id: number): Promise<void> {
  const s = e.swarm
  const track: CinemaTrackId = `s${id}`
  if (!s) return
  const p0 = await s.get(track, 0)
  if (!p0) return
  try {
    const m = parseManifest(p0)
    const fonts: Uint8Array[] = []
    for (const f of m.fonts) {
      const b = await s.get(track, f.piece)
      if (!b) return // onPiece calls again when it lands
      fonts.push(new Uint8Array(b))
    }
    if (e.closed || useCinema.getState().mine.subtitleId !== id) return
    useCinema.setState({ subtitle: { id, format: m.format, text: m.text, cues: m.format === 'vtt' ? parseVtt(m.text) : [], fonts } })
  } catch (err) {
    console.warn('[cinema] subtitle', err)
    useCinema.setState({ error: t.subtitles.loadFailed })
  }
}

// ---- host ---------------------------------------------------------------------------------------------------------------

/**
 * The host's index goes to the server merged per track, at most once per CINEMA_STATUS_INTERVAL_MS (the first batch at
 * once): the factory reports every 250 ms per track, which would blow the 300 frames/min cinema quota and get the
 * socket closed (4008), dropping the room into host_away and the index into gaps.
 */
function queuePieces(h: HostFile, track: CinemaTrackId, from: number, items: CinemaPieceMeta[]): void {
  let m = h.pending.get(track)
  if (!m) h.pending.set(track, (m = new Map()))
  items.forEach((it, i) => m.set(from + i, it))
  scheduleFlush(h)
}

function scheduleFlush(h: HostFile): void {
  if (h.flushTimer !== undefined || !h.sessionId || !h.pending.size) return
  h.flushTimer = setTimeout(() => {
    h.flushTimer = undefined
    flushPieces(h)
  }, Math.max(0, h.flushedAt + CINEMA_STATUS_INTERVAL_MS - Date.now()))
}

/** Contiguous runs in ascending n, in frames of ≤ CINEMA_ITEMS_PER_FRAME (each `from` ≤ the server's length: no gap). */
function flushPieces(h: HostFile): void {
  const sessionId = h.sessionId
  if (hostFile !== h || !sessionId) return
  h.flushedAt = Date.now()
  for (const [track, m] of h.pending) {
    const ns = [...m.keys()].sort((a, b) => a - b)
    for (let i = 0; i < ns.length;) {
      let j = i
      while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1 && j + 1 - i < CINEMA_ITEMS_PER_FRAME) j++
      const run = ns.slice(i, j + 1)
      // socket down: keep the rest for the next round
      if (!send({ op: 'cinema_pieces', sessionId, track, from: run[0]!, items: run.map((n) => m.get(n)!) })) return scheduleFlush(h)
      for (const n of run) m.delete(n)
      i = j + 1
    }
    h.pending.delete(track)
  }
}

/** The film I project from `fileId` (after probe): its index is kept from the factory's first piece on. */
export function hostBegin(fileId: string, film: CinemaFilm): void {
  hostEnd()
  const h: HostFile = { fileId, film, sessionId: null, index: new Map(), offs: [], seq: -1, pos: 0, pending: new Map(), flushTimer: undefined, flushedAt: 0 }
  hostFile = h
  h.offs.push(
    window.alga.cinema.onPieces((ev) => {
      if (hostFile !== h || ev.fileId !== h.fileId) return
      const list = h.index.get(ev.track) ?? []
      list.splice(ev.from, ev.items.length, ...ev.items)
      h.index.set(ev.track, list)
      queuePieces(h, ev.track, ev.from, ev.items)
      if (eng?.isHost && eng.sessionId === h.sessionId) eng.swarm?.setIndex(ev.track, ev.from, ev.items)
    }),
    window.alga.cinema.onError((ev) => {
      if (hostFile !== h || ev.fileId !== h.fileId) return
      console.warn('[cinema] factory', ev.track, ev.reason) // main redacts the path
      useCinema.setState({ error: t.factoryError })
    }),
    // onEvicted needs no wiring: the host swarm reads through window.alga.cinema.piece, and a piece the factory dropped
    // reads as null there, which makes the swarm answer `none` and re-announce what it holds (swarm.ts load()).
  )
  useCinema.setState({ host: { fileId } })
}

/** Stop projecting: the factory and its temp folder go. */
export function hostEnd(): void {
  const h = hostFile
  hostFile = null
  if (!h) return
  for (const off of h.offs) off()
  clearTimeout(h.flushTimer)
  void window.alga.cinema.close(h.fileId).catch(() => undefined)
  useCinema.setState({ host: { fileId: null } })
}

/** The room moved (start, seek, pause): the factory makes pieces from there (a seek back needs ensure, R4 note). */
function hostFollow(v: CinemaSessionView): void {
  const h = hostFile
  if (!h || h.sessionId !== v.sessionId || v.playback.seq === h.seq) return
  h.seq = v.playback.seq
  const pos = v.playback.position
  if (pos !== h.pos) {
    for (const track of ['v', ...v.film.audio.map((a) => `a${a.id}`)] as CinemaTrackId[]) window.alga.cinema.ensure(h.fileId, track, pos)
    h.pos = pos
  }
  window.alga.cinema.setPlayhead(h.fileId, pos)
}

// ---- dispatches ---------------------------------------------------------------------------------------------------------

function onState(d: DispatchOf<'CINEMA_STATE'>): void {
  const st = useCinema.getState()
  if ('ended' in d) {
    if (st.session?.sessionId !== d.sessionId && hostFile?.sessionId !== d.sessionId) return
    const title = st.session?.film.title ?? hostFile?.film.title ?? ''
    closeEngine()
    if (hostFile?.sessionId === d.sessionId) hostEnd()
    stopPing()
    return useCinema.setState({ session: null, ended: { title, reason: d.reason, summary: d.summary }, mine: freshMine(), busy: false })
  }
  if (d.channelId !== callChannel()) return
  if (st.session && st.session.sessionId !== d.sessionId) {
    closeEngine()
    if (hostFile?.sessionId === st.session.sessionId) hostEnd()
  }
  const me = meId()
  const seated = d.seats.some((x) => x.userId === me)
  useCinema.setState((s) => ({ session: d, ended: null, busy: false, mine: { ...s.mine, seated } }))
  startPing()
  // My cinema_open came back as a session: the factory starts now (its pieces get a session to go to).
  if (d.hostId === me && hostFile && !hostFile.sessionId) {
    hostFile.sessionId = d.sessionId
    scheduleFlush(hostFile)
    window.alga.cinema.start(hostFile.fileId, d.playback.position, d.film.audio.map((a) => a.id)).catch((err: unknown) => {
      console.warn('[cinema] start', err)
      useCinema.setState({ error: t.factoryError })
    })
  }
  if (seated) {
    if (!eng || eng.sessionId !== d.sessionId) createEngine(d)
    else {
      eng.mesh?.sync(d.seats)
      applyPlayback()
    }
  } else if (eng) closeEngine()
  if (d.hostId === me) hostFollow(d)
}

function onPieces(d: DispatchOf<'CINEMA_PIECES'>): void {
  const e = eng
  if (e && e.sessionId === d.sessionId) {
    if (e.swarm) e.swarm.setIndex(d.track, d.from, d.items)
    else e.early.push(['pieces', d.track, d.from, d.items])
    return
  }
  // The index replay of a seat comes right before its first state.
  if (earlyPieces?.sessionId !== d.sessionId) earlyPieces = { sessionId: d.sessionId, frames: [] }
  if (earlyPieces.frames.length < MAX_EARLY_FRAMES) earlyPieces.frames.push([d.track, d.from, d.items])
}

function onSignal(d: DispatchOf<'CINEMA_SIGNAL'>): void {
  const e = eng
  if (!e || e.sessionId !== d.sessionId) return
  if (e.mesh) void e.mesh.onSignal(d.from, d.signal)
  else e.early.push(['signal', d.from, d.signal])
}

function onPong(d: DispatchOf<'CINEMA_PONG'>): void {
  const r = Date.now()
  const first = !clock.hasSample()
  clock.add({ c: d.c, s: d.s, r })
  rttMs = r - d.c
  if (first) applyPlayback()
}

function onError(d: DispatchOf<'CINEMA_ERROR'>): void {
  // stale: the server sends the current state right after, which is all the answer needed
  if (d.reason === 'stale') return
  console.warn('[cinema] refused', d.op, d.reason)
  if (d.op === 'cinema_open') hostEnd()
  useCinema.setState({ error: t.errors[d.reason] || t.errors.invalid, busy: false })
}

export function handleCinemaDispatch(d: Dispatch): void {
  switch (d.t) {
    case 'READY':
      // a new gateway session: ask for the call's cinema (seat sockets are rebound by hello)
      send({ op: 'cinema_hello' })
      return
    case 'CINEMA_STATE':
      return onState(d.d)
    case 'CINEMA_PIECES':
      return onPieces(d.d)
    case 'CINEMA_SIGNAL':
      return onSignal(d.d)
    case 'CINEMA_PONG':
      return onPong(d.d)
    case 'CINEMA_ERROR':
      return onError(d.d)
  }
}

// ---- clock --------------------------------------------------------------------------------------------------------------

function startPing(): void {
  if (pingTimer !== undefined) return
  const ping = () => {
    if (!useCinema.getState().session) return stopPing()
    if (clock.jumped(Date.now(), performance.now())) clock.reset() // sleep or OS time change: ping fast again
    send({ op: 'cinema_time', c: Date.now() })
    pingTimer = setTimeout(ping, clock.nextPingDelayMs())
  }
  ping()
}

function stopPing(): void {
  clearTimeout(pingTimer)
  pingTimer = undefined
}

// ---- the stage's <video> ------------------------------------------------------------------------------------------------

/** The stage mounted its <video>: film audio goes on it and the player starts (if I am seated). */
export function attachVideo(el: HTMLVideoElement): void {
  video = el
  const audio = FilmAudio.for(el)
  const p = useCinema.getState().prefs
  audio.setVolume(p.volume)
  audio.setMuted(p.muted)
  audio.setDucking(p.ducking)
  const m = useMedia.getState().devices
  void audio.setOutput(m.outputId, m.outputs.find((x) => x.deviceId === m.outputId)?.label ?? null).then(() => {
    if (!audio.echoRisk() || stored().echoSeen) return
    store({ echoSeen: true })
    useCinema.setState((s) => ({ notices: [...s.notices, t.audio.echoNotice] }))
  })
  useCinema.setState({ audio })
  if (eng) attachPlayer(eng)
}

export function detachVideo(el: HTMLVideoElement): void {
  if (video !== el) return
  video = null
  if (eng?.player) {
    eng.player.destroy()
    eng.player = null
    eng.stalled = false
  }
  useCinema.getState().audio?.release()
  useCinema.setState({ audio: null })
}

// ---- what the stage reads -----------------------------------------------------------------------------------------------

export function cinemaStats(): CinemaStats {
  const e = eng
  const c = useCinema.getState().cache
  const room = roomPos()
  const lat = useCinema.getState().audio?.outputLatencyMs() ?? 0
  const v = e?.player && video ? video.currentTime : null
  return {
    cache: c && { kind: c.kind, capGB: Math.round((c.capBytes / GiB) * 10) / 10 },
    clock: { offsetMs: clock.offsetMs(), rttMs },
    swarm: e?.swarm?.stats() ?? null,
    player: e?.player?.stats() ?? null,
    relayed: e?.mesh?.relayed() ?? [],
    // the player runs ahead of the room by the audio output latency (R28), so compare at now + latency
    driftMs: v === null ? null : Math.round((v - positionAt(useCinema.getState().session!.playback, clock.serverNow() + lat, e!.film.durationS)) * 1000),
    roomS: room,
    videoS: v,
    audioTrack: (() => {
      const id = useCinema.getState().mine.audioId
      return id === null ? null : `a${id}${e?.pendingAudio !== null && e?.pendingAudio !== undefined ? ` → a${e.pendingAudio}` : ''}`
    })(),
  }
}

/** Server time now (ms), for the stage's countdowns and time display. */
export const serverNow = (): number => clock.serverNow()

// ---- intents the actions use ----------------------------------------------------------------------------------------------

export function chooseAudio(id: number): void {
  useCinema.setState((s) => ({ mine: { ...s.mine, audioId: id } }))
  if (eng) switchAudio(eng, id)
}

export function chooseSubtitle(id: number | null): void {
  useCinema.setState((s) => ({ mine: { ...s.mine, subtitleId: id }, subtitle: null }))
  if (!eng) return
  syncTracks(eng)
  if (id !== null) void loadSubtitle(eng, id)
}

export function setPrefs(patch: Partial<CinemaState['prefs']>): void {
  const prefs = { ...useCinema.getState().prefs, ...patch }
  prefs.volume = Math.min(1, Math.max(0, prefs.volume))
  useCinema.setState({ prefs })
  store(prefs)
  const a = useCinema.getState().audio
  a?.setVolume(prefs.volume)
  a?.setMuted(prefs.muted)
  a?.setDucking(prefs.ducking)
}

/** The first time someone sits (spec §6.4): direct connections reveal the IP between seats. */
export function ipNoticeOnce(): void {
  if (stored().ipSeen) return
  store({ ipSeen: true })
  useCinema.setState((s) => ({ notices: [...s.notices, t.ipNotice] }))
}

// ---- lifecycle ----------------------------------------------------------------------------------------------------------

/** Everything back to no session (tests; sign-out). */
export function resetCinema(): void {
  closeEngine()
  hostEnd()
  stopPing()
  earlyPieces = null
  rttMs = null
  useCinema.setState(initial())
}

/** Wired once per signed-in shell (voice.ts startVoiceSync). Returns the cleanup. */
export function startCinema(): () => void {
  void clearStaleOpfs() // swarm caches a crash left behind (no session can be open yet)
  const offs = [
    onDispatch(handleCinemaDispatch),
    useMedia.subscribe((s, prev) => {
      // Left the call (or moved to another): the session is no longer mine to show; the server unseats me.
      const now = s.connection.state === 'idle' || s.connection.state === 'disconnected' ? null : s.connection.channelId
      const was = prev.connection.state === 'idle' || prev.connection.state === 'disconnected' ? null : prev.connection.channelId
      const sess = useCinema.getState().session
      if (now !== was && sess && sess.channelId !== now) {
        closeEngine()
        if (hostFile?.sessionId === sess.sessionId) hostEnd()
        stopPing()
        useCinema.setState({ session: null, mine: freshMine(), draft: null })
      }
      // In the call now: ask for its session (the server knows we are in voice once we are connected).
      if (s.connection.state === 'connected' && prev.connection.state !== 'connected') send({ op: 'cinema_hello' })
    }),
  ]
  return () => {
    for (const off of offs) off()
    resetCinema()
  }
}
