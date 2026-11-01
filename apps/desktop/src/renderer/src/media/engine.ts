// The media engine: one LiveKit room at a time (voice channel), mic pipeline, devices, hotkeys,
// resilience and screen sharing. The UI talks to `media` and reads `useMedia`; never to livekit-client.
import {
  AudioPresets,
  DefaultReconnectPolicy,
  DisconnectReason,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  VideoQuality,
  createLocalAudioTrack,
  type AudioCaptureOptions,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublishOptions,
} from 'livekit-client'
// LiveKit's frame cryptor (AES-GCM per frame): its own chunk, loaded from 'self' (CSP worker-src 'self' blob:).
import E2eeWorker from 'livekit-client/e2ee-worker?worker'
import { DECODE_ATTRIBUTE, STREAM_PRESETS_ATTRIBUTE } from '@alga/shared'
import { ApiRequestError } from '@/lib/api'
import { onDispatch, useSession } from '@/store/session'
import type { E2eeEpochInfo, E2eeFrameKey } from '../../../shared/bridge'
import { AlgaKeyProvider, callMode, mismatchOf, settled } from './e2ee'
import { PttLatch, perceptualLevel, rmsDb } from './vad'
import { PrefsStore, type InputMode, type ProcessingMode } from './prefs'
import { HEVC_MIN_SIDE, aboveContract, availablePresets, clampPreset, contentSettings, decodable, decodeName, gatePresets, isPresetId, peerDecode, pickCodec, recordSustain, roomCodec, simulcastFor, type ContentType, type ScreenPreset, type ScreenPresetId, type VideoCodecId } from './presets'
import { VoiceGraph, VoiceProcessor, captureConstraints } from './processing'
import { playCue, setCueOutput, startRing, stopRing, type Cue, type RingKind } from './sounds'
import { stallStep, type StallState } from './stall'
import { StatsDelta, audioIn, audioOut, videoIn, videoOut } from './stats'
import { initialState, patch, useMedia, type ConnectionState, type MediaState, type DeviceInfo, type ParticipantView, type Quality, type StreamQuality } from './store'
import type { GateReport } from './vad-gate.worklet'

export interface JoinParams {
  url: string
  token: string
  /** Opus target for this channel (VoiceJoinResponse.bitrateKbps). Default 64. */
  bitrateKbps?: number
  channelId?: string
  /** VoiceJoinResponse.e2ee: the server's call for this call. Omitted (older server, lab tokens) = whenever this client can. */
  e2ee?: boolean
  /** Fresh credentials (and E2EE flag) for automatic rejoin (tokens are short-lived) and VOICE_E2EE_CHANGED. */
  refresh?: () => Promise<{ url: string; token: string; e2ee?: boolean }>
  /** false = join listen-only (no mic capture). */
  publishMic?: boolean
  /** Voice RED (each packet repeats the previous frame). Default true: measured in docs/benchmarks/media-network.md. */
  red?: boolean
  /** Screen-share presets the user's plan allows (VoiceJoinResponse.streamPresets). The token attribute, when present, wins. */
  streamPresets?: readonly string[]
}

export interface ScreenShareOptions {
  /** CaptureSource.id from window.alga.screen.getSources(); omitted = let getDisplayMedia pick. */
  sourceId?: string | null
  /** Capture system audio (loopback) and publish it as screen_share_audio. */
  audio?: boolean
  quality?: ScreenPresetId
  contentType?: ContentType
  codec?: VideoCodecId
  /** Publish this already-captured stream instead of calling getDisplayMedia (test patterns, future native capture). */
  stream?: MediaStream
}

// Adaptive stream sizes subscribed video to the element it plays in (device pixels); paused when hidden.
const ADAPTIVE = { pixelDensity: 'screen' as const }
const DEFAULT_KBPS = 64
// Denser than LiveKit's default [0,300,1200,2700,4800,7000…]: after a 3 s SFU restart that default took
// median 6.0 s to recover once the SFU was back, this one 3.4 s (docs/benchmarks/media-baseline.md §1.5). ~45 s window.
const RECONNECT_DELAYS_MS = [0, 300, 600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 4000, 5000, 5000, 7000, 7000]
const REJOIN_BACKOFF_MS = [1000, 2000, 5000, 10000, 20000]
const MIME: Record<VideoCodecId, string> = { h264: 'video/H264', h265: 'video/H265', vp8: 'video/VP8', vp9: 'video/VP9', av1: 'video/AV1' }

const DISCONNECT_TEXT: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.CLIENT_INITIATED]: 'Você saiu do canal.',
  [DisconnectReason.DUPLICATE_IDENTITY]: 'Você entrou neste canal em outro dispositivo.',
  [DisconnectReason.SERVER_SHUTDOWN]: 'O servidor de voz reiniciou.',
  [DisconnectReason.PARTICIPANT_REMOVED]: 'Você foi removido do canal.',
  [DisconnectReason.ROOM_DELETED]: 'O canal foi encerrado.',
  [DisconnectReason.STATE_MISMATCH]: 'Estado da conexão inconsistente.',
  [DisconnectReason.JOIN_FAILURE]: 'Falha ao entrar no canal.',
  [DisconnectReason.SIGNAL_CLOSE]: 'A conexão com o servidor de voz caiu.',
  [DisconnectReason.CONNECTION_TIMEOUT]: 'A conexão com o servidor de voz expirou.',
  [DisconnectReason.MEDIA_FAILURE]: 'Falha no transporte de mídia (rede/firewall).',
}
/** Reasons where rejoining automatically would fight the user or the server. */
const TERMINAL = new Set([DisconnectReason.CLIENT_INITIATED, DisconnectReason.DUPLICATE_IDENTITY, DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED])

/** protobuf TrackSource.MICROPHONE in ParticipantPermission.canPublishSources (livekit-client doesn't re-export the enum). */
const PROTO_MICROPHONE = 2
const LEVEL_TICK_MS = 50
/** Longest a republished share keeps the old publication (well inside the server's 10 s PLAN_RECHECK_MS). */
const REPUBLISH_OVERLAP_MS = 3000
/** Stall guard (viewer side) poll period. */
const STALL_TICK_MS = 200
/** Longest wait for the call's MLS epoch (and our cryptor) before a join fails closed. */
const E2EE_SETUP_MS = 10_000
/** Room changes (joins, leaves, decode lists) settle this long before a live share's codec is re-decided. */
const CODEC_SETTLE_MS = 500
/** A watched stream with bytes arriving and no decoded picture for this many stats ticks (1 s) = decoder failure. */
const DECODE_FAIL_TICKS = 5

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const bridge = (): Partial<Window['alga']> | undefined => (typeof window !== 'undefined' ? window.alga : undefined)
const safeStorage = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

class MediaEngine {
  readonly prefs = new PrefsStore(typeof window !== 'undefined' ? safeStorage() : null)
  private room: Room | null = null
  private graph: VoiceGraph | null = null
  private mic: LocalAudioTrack | null = null
  private last: JoinParams | null = null
  private userLeft = true
  private reconnectT0 = 0
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null
  private rejoinAttempt = 0
  private ptt = new PttLatch(this.prefs.get().pttReleaseMs)
  private pttTimer: ReturnType<typeof setTimeout> | null = null
  private ptmActive = false
  private mutedBeforeDeafen = false
  private uiTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private deltas = new Map<string, StatsDelta>()
  private audioEls = new Set<HTMLMediaElement>()
  private viewerEls = new Map<string, Set<HTMLVideoElement>>()
  /** `declared`: the preset of the video publication (the SFU keeps its layers; an in-place re-cap changes `preset` only). */
  private screenPub: { video: LocalTrackPublication; audio: LocalTrackPublication | null; preset: ScreenPreset; declared: ScreenPreset; cpuLimited: boolean[]; sourceId: string | null; codec: VideoCodecId; want: VideoCodecId } | null = null
  /** Presets this machine sustains (probeEncoder); the conservative software list until the probe answers. */
  private capable: ScreenPreset[] = availablePresets({ hardware: false })
  /** Presets the user's plan allows (join response, token attribute, Me.plan); null = unknown. */
  private plan: ScreenPresetId[] | null = null
  /** Live re-caps run one at a time (a plan change arrives as ENTITLEMENTS_UPDATE, ME_UPDATE and the attribute). */
  private recapOp: Promise<void> = Promise.resolve()
  private activeInput: string | null = null
  private activeOutput: string | null = null
  private test: { graph: VoiceGraph | null; stream: MediaStream | null; el: HTMLAudioElement | null } = { graph: null, stream: null, el: null }
  private noticeId = 0
  private levelSmooth = 0
  private started = false
  /** Mic publish/unpublish run one at a time (join, permission changes and server unpublish can race). */
  private micOp: Promise<void> = Promise.resolve()
  /** <video>s showing my own outgoing screen (attachOwnScreen). */
  private ownEls = new Set<HTMLVideoElement>()
  /** Per remote mic: analyser on the decoded track for `participants[id].level`. One context for all. */
  private meterCtx: AudioContext | null = null
  private meters = new Map<string, { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Float32Array<ArrayBuffer>; level: number }>()
  private levelTimer: ReturnType<typeof setInterval> | null = null
  private channelName: string | null = null
  /** Per watched stream: decode progress and the temporary layer cap of the stall guard. */
  private stalls = new Map<string, StallState>()
  private stallTimer: ReturnType<typeof setInterval> | null = null
  /** Lab only: false = leave layer switching to the SFU (measures what the guard buys, media-network.md §3). */
  stallGuard = true
  /** Mic re-published because the SFU answered it without DTX (ensureDtx); read by the lab. */
  private dtxRepairs = 0
  /**
   * E2EE of the current call (decision 0004; README §E2EE). Kept across automatic rejoins of the same channel: the
   * newest key of each remote sender, ours (`own`, the one we send with; `next` waits for its epoch to go active).
   */
  private call: { channelId: string; remote: Map<string, E2eeFrameKey>; own: E2eeFrameKey | null; next: E2eeFrameKey | null; active: boolean } | null = null
  /** Per Room: LiveKit's key provider and its frame-cryptor worker. */
  private keys: AlgaKeyProvider | null = null
  private cryptor: Worker | null = null
  /** Joins waiting for the epoch: called with null when we may publish, or with the reason it failed. */
  private e2eeWaiters = new Set<(err: string | null) => void>()
  private mismatchSince = new Map<string, number>()
  /** Lab only: join without E2EE even when main runs it (baselines, direct LiveKit tokens). */
  labNoE2ee = false
  /** Lab only: HEVC layer floor (0 lets a too-small HEVC share out, to exercise the viewer-side fallback). */
  hevcMinSide = HEVC_MIN_SIDE
  /** Codecs this client failed to decode in this session: no longer advertised, so senders switch away from them. */
  private brokenDecoders = new Set<VideoCodecId>()
  /** Per watched stream: consecutive stats ticks with bytes arriving and no picture. */
  private undecoded = new Map<string, number>()
  /** Hardware encoder per codec (probeEncoder). */
  private hw: Partial<Record<VideoCodecId, boolean>> = {}
  private codecTimer: ReturnType<typeof setTimeout> | null = null

  /** Wire OS/bridge integrations once (idempotent). Called lazily by every public entry point. */
  private start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const p = this.prefs.get()
    this.activeInput = p.inputDeviceId
    this.activeOutput = p.outputDeviceId
    patch('self', { inputMode: p.inputMode, processing: p.processing, processingActive: p.processing, sensitivityDb: p.sensitivityDb, sounds: p.sounds, pttReleaseMs: p.pttReleaseMs })
    patch('screen', { preset: p.screenPreset, contentType: p.contentType, ...(p.codec && { codec: p.codec }), codecAuto: !p.codec })
    patch('devices', { inputId: p.inputDeviceId, outputId: p.outputDeviceId })
    setCueOutput(p.outputDeviceId)
    navigator.mediaDevices?.addEventListener('devicechange', () => void this.refreshDevices(true))
    window.addEventListener('online', () => this.verifySoon())
    const b = bridge()
    b?.power?.onResume?.(() => this.verifySoon())
    b?.hotkeys?.onEvent?.((e) => this.onHotkey(e.action, e.phase))
    b?.tray?.onAction?.((a) => {
      if (a === 'toggleMute') void this.toggleMute()
      else if (a === 'toggleDeafen') void this.toggleDeafen()
      else void this.leave()
    })
    void this.refreshDevices(false)
    this.syncPlan()
    void this.probeEncoder()
    onDispatch((d) => {
      if (d.t === 'VOICE_E2EE_CHANGED') void this.onE2eeChanged(d.d)
    })
    // E2EE relay (main has the MLS state; the gateway is the renderer's): every E2EE_* dispatch in, every e2ee_* frame out.
    const e2ee = b?.e2ee
    if (e2ee) {
      onDispatch((d) => {
        // Main would retry it until the call fails: the call is plain now and VOICE_E2EE_CHANGED (sent first) rejoins.
        if (d.t === 'E2EE_RESYNC_REQUIRED' && d.d.reason === 'not_e2ee') return
        if (d.t.startsWith('E2EE_')) e2ee.handleDispatch(d.t, d.d)
        // A new gateway session: re-announce our epoch so the DS resends what we missed (0004 §3.6).
        else if (d.t === 'READY' && this.call && !this.userLeft) void e2ee.joinCall(this.call.channelId).catch(() => undefined)
      })
      e2ee.onGatewaySend((frame) => void useSession.getState().send(frame))
      e2ee.onFrameKey((k) => void this.onFrameKey(k))
      e2ee.onEpoch((e) => void this.onEpoch(e))
    }
  }

  // ───────────────────────────── voice ─────────────────────────────

  async join(params: JoinParams): Promise<void> {
    this.rejoinAttempt = 0
    return this.connect(params)
  }

  /** Human channel name for the tray (and `connection.channelName`); kept across automatic rejoins, cleared by leave(). */
  setContext(ctx: { channelName?: string | null }): void {
    this.start()
    if (ctx.channelName !== undefined) this.channelName = ctx.channelName
    patch('connection', { channelName: this.channelName })
    this.syncTray()
  }

  private async connect(params: JoinParams): Promise<void> {
    this.start()
    if (this.room) await this.leave(true)
    this.clearRejoin()
    this.last = params
    this.userLeft = false
    if (params.streamPresets) this.setPlanPresets(params.streamPresets)
    const t0 = performance.now()
    this.setConn('connecting', null, { channelId: params.channelId ?? null, joinMs: null })
    const kbps = params.bitrateKbps ?? DEFAULT_KBPS
    let e2ee: { joined: Promise<void> } | null
    let room: Room
    try {
      // In parallel with the LiveKit connection: the MLS join (0004 §3.4). null = this call is not E2EE.
      e2ee = await this.e2eeStart(params.channelId, params.e2ee)
      room = new Room({
        adaptiveStream: ADAPTIVE,
        dynacast: true,
        // Remote audio through WebAudio: enables >100% per-user gain and AudioContext.setSinkId.
        webAudioMix: true,
        audioOutput: { deviceId: this.activeOutput ?? 'default' },
        publishDefaults: { dtx: true, red: params.red !== false, forceStereo: false, audioPreset: { maxBitrate: kbps * 1000 }, stopMicTrackOnMute: false },
        disconnectOnPageLeave: true,
        reconnectPolicy: new DefaultReconnectPolicy(RECONNECT_DELAYS_MS),
        ...(e2ee && { e2ee: { keyProvider: this.keys!, worker: this.cryptor! } }),
      })
    } catch (e) {
      // E2EE expected but unusable here (no channel, unsupported browser): nothing was connected or published.
      await this.failClosed(`Criptografia de ponta a ponta indisponível: ${errText(e)}.`)
      throw e
    }
    this.room = room
    this.wire(room)
    try {
      // Before connecting: every track this Room ever publishes is encrypted (AddTrackRequest says GCM).
      if (e2ee) await room.setE2EEEnabled(true)
      // Video is subscribed on demand (watch()); voice is subscribed explicitly in addRemote().
      await room.connect(params.url, params.token, { autoSubscribe: false })
    } catch (e) {
      if (this.room === room) {
        this.room = null
        room.removeAllListeners()
        // An automatic rejoin attempt failing is not the end: scheduleRejoin() follows unless the backoff ran out.
        const willRetry = this.rejoinAttempt > 0 && REJOIN_BACKOFF_MS[this.rejoinAttempt] !== undefined
        if (!willRetry) this.endE2ee()
        this.setConn('disconnected', `Não foi possível conectar ao servidor de voz: ${errText(e)}`, { willRetry })
      }
      throw e
    }
    if (this.room !== room) return
    void room.startAudio().catch(() => undefined)
    patch('self', { identity: room.localParticipant.identity })
    this.planFromRoom(room)
    for (const rp of room.remoteParticipants.values()) this.addRemote(rp)
    if (e2ee) {
      // Fail closed: nothing is published before the epoch is active and our cryptor confirmed encryption.
      try {
        await e2ee.joined
        await this.untilActive(room)
      } catch (e) {
        if (this.room !== room) return
        await this.failClosed(errText(e))
        throw e
      }
      if (this.room !== room) return
    }
    await this.syncMic(room)
    if (this.room !== room) return
    this.rejoinAttempt = 0
    this.setConn('connected', null, { room: room.name, joinMs: Math.round(performance.now() - t0) })
    void this.syncMic(room) // a permission change during the handshake was deferred to here
    this.startTimers()
    this.cue('join')
    this.syncTray()
  }

  async leave(silent = false): Promise<void> {
    this.userLeft = true
    this.clearRejoin()
    const room = this.room
    this.endE2ee()
    patch('e2ee', initialState().e2ee)
    if (!room) {
      if (!silent) this.channelName = null
      this.setConn('idle', null, { channelName: this.channelName })
      return
    }
    await this.stopScreenShare(true).catch(() => undefined)
    this.room = null
    await this.teardown()
    await room.disconnect(true).catch(() => undefined)
    room.removeAllListeners()
    if (!silent) {
      this.cue('leave')
      this.channelName = null
    }
    this.setConn('idle', null, { room: null, channelId: null, channelName: this.channelName })
    this.syncTray()
  }

  /** Server mute = the SFU dropped `microphone` from canPublishSources. Empty list = every source allowed. */
  private micAllowed(room: Room): boolean {
    const p = room.localParticipant.permissions
    return !p || (p.canPublish && (p.canPublishSources.length === 0 || p.canPublishSources.includes(PROTO_MICROPHONE)))
  }

  /**
   * Make the mic match what we want and what the server allows: publish when allowed (muted if the user is
   * self-muted, like at join), drop capture when revoked. Runs at join and on every permission change.
   */
  private syncMic(room: Room): Promise<void> {
    const run = async () => {
      if (this.room !== room) return
      const allowed = this.micAllowed(room)
      patch('self', { serverMuted: !allowed })
      if (this.last?.publishMic === false) return
      if (allowed && !this.mic) await this.publishMic(room, this.last?.bitrateKbps ?? DEFAULT_KBPS)
      else if (!allowed && this.mic) await this.dropMic(room)
      this.syncTray()
    }
    this.micOp = this.micOp.then(run, run)
    return this.micOp
  }

  /** Unpublish + stop capture + close the graph (server mute, or the SFU unpublished it). */
  private async dropMic(room: Room | null): Promise<void> {
    const mic = this.mic
    const graph = this.graph
    this.mic = null
    this.graph = null
    if (mic) {
      await room?.localParticipant.unpublishTrack(mic, true).catch(() => undefined)
      mic.stop()
    }
    await graph?.close()
    patch('self', { speaking: false, level: 0, gateOpen: false })
  }

  private async publishMic(room: Room, kbps: number, repairs = 0): Promise<void> {
    const p = this.prefs.get()
    const graph = new VoiceGraph({ rnnoise: false, onReport: (r) => this.onGateReport(r) })
    this.graph = graph
    this.applyGate()
    try {
      const track = await createLocalAudioTrack(captureConstraints(p.processing, this.activeInput))
      await track.setAudioContext(graph.ctx)
      await track.setProcessor(new VoiceProcessor(graph))
      this.mic = track
      await this.applyRnnoise(p.processing)
      const s = useMedia.getState().self
      if (s.muted || s.deafened) await track.mute()
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: decodeName(this.decodeCaps()), dtx: true, red: this.last?.red !== false, forceStereo: false, audioPreset: { maxBitrate: kbps * 1000 } })
      patch('self', { micAvailable: true })
      patch('devices', { inputId: this.activeInput })
      void this.refreshDevices(false)
      // After the join, not in its way: queued behind this op. At most 2 repairs (the race can repeat right away).
      if (repairs < 2) this.micOp = this.micOp.then(() => this.ensureDtx(room, track, kbps, repairs + 1))
    } catch (e) {
      this.mic?.stop()
      this.mic = null
      await graph.close()
      this.graph = null
      patch('self', { micAvailable: false })
      this.notify(`Microfone indisponível (${errText(e)}). Você está só ouvindo.`)
    }
  }

  /**
   * Now and then (3 of 24 joins, media-network.md §2) the SFU answers the mic's m-line like an unmapped placeholder:
   * Opus `stereo=1` without `usedtx`, i.e. 50 packets/s of silence instead of ~5. Seen on the negotiated sender
   * codec. The fix is the server-unmute path: drop the mic and publish a fresh one (new capture, new m-line, new
   * AddTrackRequest). Re-publishing the same track was measured to leave it silent (0 packets/s, nothing heard).
   */
  private async ensureDtx(room: Room, track: LocalAudioTrack, kbps: number, attempt: number): Promise<void> {
    const fmtp = await opusFmtp(track)
    if (fmtp === null || fmtp.includes('usedtx=1') || this.room !== room || this.mic !== track) return
    this.dtxRepairs++
    // The second try waits a moment: one bad answer right after another was seen once in 32 joins.
    if (attempt > 1) await new Promise((r) => setTimeout(r, 1000))
    if (this.room !== room || this.mic !== track) return
    await this.dropMic(room)
    if (this.room === room && this.micAllowed(room)) await this.publishMic(room, kbps, attempt)
  }

  private wire(room: Room): void {
    room
      .on(RoomEvent.ParticipantConnected, (rp) => {
        this.addRemote(rp)
        this.cue('join')
        this.syncCodecSoon()
      })
      .on(RoomEvent.ParticipantDisconnected, (rp) => {
        this.syncCodecSoon()
        this.viewerEls.delete(rp.identity)
        this.dropMeter(rp.identity)
        useMedia.setState((s) => {
          const viewers = { ...s.viewers }
          delete viewers[rp.identity]
          return { viewers }
        })
        this.cue('leave')
      })
      .on(RoomEvent.TrackPublished, (pub, rp) => this.onRemotePublished(pub, rp))
      .on(RoomEvent.TrackSubscribed, (track, pub, rp) => this.onSubscribed(track, pub, rp))
      .on(RoomEvent.TrackUnsubscribed, (track, pub, rp) => {
        for (const el of track.detach()) if (this.audioEls.delete(el)) el.remove()
        if (pub.source === Track.Source.Microphone) this.dropMeter(rp.identity)
      })
      // Only while connected: connect() and Reconnected reconcile themselves (publishing mid-handshake isn't safe).
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
        if (p === room.localParticipant && useMedia.getState().connection.state === 'connected') void this.syncMic(room)
      })
      // The server rewrites this attribute when the plan changes mid-call (billing → voice.setStreamPresets).
      .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
        if (p === room.localParticipant && STREAM_PRESETS_ATTRIBUTE in changed) this.planFromRoom(room)
      })
      // The SFU can unpublish our mic itself (permission revoked): LiveKit stops the track; release our side too.
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.Microphone && this.mic && pub.track === this.mic) {
          this.micOp = this.micOp.then(() => this.dropMic(null))
        }
      })
      .on(RoomEvent.TrackUnpublished, (pub, rp) => {
        // Another one left = a republish (plan downgrade): whoever watched follows the new one.
        if (pub.source === Track.Source.ScreenShare && !screenOf(rp)) this.unwatch(rp.identity)
        if (pub.source === Track.Source.Microphone) this.syncCodecSoon()
      })
      .on(RoomEvent.SignalReconnecting, () => this.onReconnecting())
      .on(RoomEvent.Reconnecting, () => this.onReconnecting())
      .on(RoomEvent.Reconnected, () => {
        const ms = this.reconnectT0 ? Math.round(performance.now() - this.reconnectT0) : null
        this.reconnectT0 = 0
        this.setConn('connected', null, { lastReconnectMs: ms, reconnects: useMedia.getState().connection.reconnects + 1 })
        void this.syncMic(room)
        this.planFromRoom(room)
      })
      .on(RoomEvent.Disconnected, (reason) => void this.onDisconnected(room, reason))
      .on(RoomEvent.MediaDevicesError, (e) => this.notify(`Erro de dispositivo: ${errText(e)}`))
  }

  private onReconnecting(): void {
    if (useMedia.getState().connection.state === 'reconnecting') return
    this.reconnectT0 = performance.now()
    this.setConn('reconnecting', 'Conexão instável — reconectando…')
  }

  private async onDisconnected(room: Room, reason?: DisconnectReason): Promise<void> {
    if (this.room !== room) return
    this.room = null
    room.removeAllListeners()
    // Hot-mic safety: whatever happens next, capture stops now.
    await this.teardown()
    const text = (reason !== undefined && DISCONNECT_TEXT[reason]) || 'Conexão com o canal de voz perdida.'
    this.cue('disconnect')
    this.syncTray()
    if (this.userLeft || (reason !== undefined && TERMINAL.has(reason)) || !this.last) {
      this.endE2ee()
      this.setConn('disconnected', text)
      return
    }
    this.scheduleRejoin(`${text} Tentando entrar de novo…`)
  }

  private scheduleRejoin(text = useMedia.getState().connection.reason): void {
    this.clearRejoin()
    const delay = REJOIN_BACKOFF_MS[this.rejoinAttempt]
    if (delay === undefined) {
      this.endE2ee()
      this.setConn('disconnected', 'Sem conexão com o servidor de voz. Entre no canal de novo quando a rede voltar.')
      return
    }
    this.rejoinTimer = setTimeout(() => void this.rejoin(), navigator.onLine === false ? Math.max(delay, 5000) : delay)
    this.setConn('disconnected', text)
  }

  private async rejoin(): Promise<void> {
    const last = this.last
    if (!last || this.userLeft) return
    this.rejoinAttempt++
    try {
      const fresh = last.refresh ? await last.refresh() : null
      await this.connect({ ...last, ...(fresh ?? {}) })
    } catch (e) {
      // The call became E2EE and this client can't do it (409, VoiceJoinBody.capabilities): retrying can't help.
      if (e instanceof ApiRequestError && e.status === 409 && e.fields?.['capabilities.e2ee']) {
        return this.failClosed('Esta chamada passou a ser criptografada de ponta a ponta, e este app não tem suporte.', false)
      }
      if (!this.userLeft) this.scheduleRejoin()
    }
  }

  /**
   * The call's E2EE flag changed (Space.e2ee toggled, or our token predates the change): leave and rejoin through
   * `refresh` (new token and flag), like an automatic rejoin. Mute/deafen carry over; a share of a picked source is
   * captured again, any other one stops with a notice.
   */
  private async onE2eeChanged(d: { channelId: string; e2ee: boolean }): Promise<void> {
    const last = this.last
    if (!last?.refresh || this.userLeft || last.channelId !== d.channelId || last.e2ee === d.e2ee) return
    const s = useMedia.getState().screen
    const share = s.active ? { sourceId: s.sourceId, audio: s.audio } : null
    this.clearRejoin()
    this.setConn('reconnecting', d.e2ee ? 'Ativando a criptografia de ponta a ponta…' : 'Desativando a criptografia de ponta a ponta…')
    const room = this.room
    this.room = null
    await this.teardown()
    room?.removeAllListeners()
    await room?.disconnect(true).catch(() => undefined)
    this.rejoinAttempt = 0
    await this.rejoin()
    if (!share) return
    if (share.sourceId && this.room && this.last?.channelId === d.channelId && useMedia.getState().connection.state === 'connected') {
      const ok = await this.startScreenShare({ sourceId: share.sourceId, audio: share.audio }).then(() => true, () => false)
      if (ok) return
    }
    this.notify('A criptografia da chamada mudou e a sua transmissão parou. Transmita de novo quando quiser.')
  }

  private clearRejoin(): void {
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer)
    this.rejoinTimer = null
  }

  /** After OS resume / network back: make sure the call is really alive, rejoin if not. */
  private verifySoon(): void {
    setTimeout(() => void this.verify(), 1500)
  }

  private async verify(): Promise<void> {
    if (!this.last || this.userLeft) return
    const state = useMedia.getState().connection.state
    if (state === 'disconnected') {
      this.clearRejoin()
      this.rejoinAttempt = 0
      return this.rejoin()
    }
    if (state !== 'connected') return
    if (await this.transportAlive()) return
    this.setConn('reconnecting', 'Conexão perdida após suspensão/troca de rede — entrando de novo…')
    const room = this.room
    this.room = null
    await this.teardown()
    room?.removeAllListeners()
    await room?.disconnect(true).catch(() => undefined)
    this.rejoinAttempt = 0
    await this.rejoin()
  }

  private async transportAlive(): Promise<boolean> {
    const track = this.mic ?? [...(this.room?.remoteParticipants.values() ?? [])].flatMap((p) => [...p.trackPublications.values()]).find((t) => t.track)?.track
    if (!track) return true
    const count = async (): Promise<number> => {
      let n = 0
      ;(await track.getRTCStatsReport())?.forEach((s: Record<string, unknown>) => {
        if (s.type === 'candidate-pair' && s.nominated) n += Number(s.bytesReceived ?? 0) + Number(s.responsesReceived ?? 0)
      })
      return n
    }
    const a = await count()
    await new Promise((r) => setTimeout(r, 4000))
    return (await count()) > a
  }

  private async teardown(): Promise<void> {
    this.stopTimers()
    for (const el of this.ownEls) this.screenPub?.video.track?.detach(el)
    for (const id of [...this.meters.keys()]) this.dropMeter(id)
    void this.meterCtx?.close().catch(() => undefined)
    this.meterCtx = null
    this.screenPub?.video.track?.stop()
    this.screenPub?.audio?.track?.stop()
    this.screenPub = null
    this.mic?.stop()
    this.mic = null
    await this.graph?.close()
    this.graph = null
    if (this.test.el && !this.test.graph) this.stopLoopback()
    for (const el of this.audioEls) el.remove()
    this.audioEls.clear()
    this.deltas.clear()
    const init = initialState()
    useMedia.setState({ participants: {}, viewers: {}, local: null })
    patch('screen', { active: false, stats: null, sourceId: null })
    patch('self', { speaking: false, level: 0, levelDb: init.self.levelDb, gateOpen: false, quality: 'unknown', serverMuted: false })
  }

  private setConn(state: ConnectionState, reason: string | null, extra: Partial<MediaState['connection']> = {}): void {
    // A retry is pending while LiveKit reconnects, while a scheduled rejoin waits and while it connects.
    const willRetry = state === 'reconnecting' || (state === 'connecting' && this.rejoinAttempt > 0) || (state === 'disconnected' && this.rejoinTimer !== null)
    patch('connection', { state, reason, willRetry, ...extra })
  }

  // ───────────────────────────── E2EE (decision 0004) ─────────────────────────────

  /**
   * Whether this call is E2EE is the server's (`server` = VoiceJoinResponse.e2ee, see callMode); this client can do it
   * unless main says it is off (build without ALGA_E2EE, signed out), an unknown status counting as able. The lab's
   * baselines join plain. null = not E2EE. Otherwise: a fresh key provider + cryptor for the new Room (the newest keys
   * replayed after an automatic rejoin), the MLS join sent, and its promise (rejects = fail closed).
   */
  private async e2eeStart(channelId: string | undefined, server: boolean | undefined): Promise<{ joined: Promise<void> } | null> {
    const api = bridge()?.e2ee
    const capable = !!api && (await api.status().catch(() => null))?.state !== 'off'
    const mode = this.labNoE2ee ? 'plain' : callMode(server, capable)
    if (mode === 'plain') {
      this.endE2ee()
      patch('e2ee', initialState().e2ee)
      return null
    }
    if (mode === 'unsupported' || !api) throw new Error('esta chamada exige, e este app não a tem ligada')
    if (!channelId) throw new Error('canal desconhecido')
    if (this.call?.channelId !== channelId) {
      this.endE2ee()
      this.call = { channelId, remote: new Map(), own: null, next: null, active: false }
    }
    const call = this.call!
    this.cryptor?.terminate()
    this.cryptor = new E2eeWorker()
    this.keys = new AlgaKeyProvider()
    // Ours last: setting it also selects the slot we encrypt with.
    for (const k of [...call.remote.values(), ...(call.own ? [call.own] : [])]) await this.keys.setKey(k.userId, k.keyIndex, k.key)
    patch('e2ee', { state: call.active ? 'active' : 'establishing' })
    const joined = api.joinCall(channelId)
    joined.catch(() => undefined) // awaited after room.connect; not an unhandled rejection meanwhile
    return { joined }
  }

  /** Resolves once the epoch is active and LiveKit confirmed our own cryptor is on; rejects with the failure reason. */
  private untilActive(room: Room, ms = E2EE_SETUP_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = (err: string | null = null) => {
        if (err !== null) done(err)
        else if (this.call?.active && room.isE2EEEnabled) done(null)
      }
      const onEncryption = () => check()
      const t = setTimeout(() => done('A criptografia de ponta a ponta não ficou pronta a tempo.'), ms)
      const done = (err: string | null) => {
        clearTimeout(t)
        this.e2eeWaiters.delete(check)
        room.off(RoomEvent.ParticipantEncryptionStatusChanged, onEncryption)
        if (err === null) resolve()
        else reject(new Error(err))
      }
      this.e2eeWaiters.add(check)
      room.on(RoomEvent.ParticipantEncryptionStatusChanged, onEncryption)
      check()
    })
  }

  private async onFrameKey(k: E2eeFrameKey): Promise<void> {
    const c = this.call
    if (!c || k.channelId !== c.channelId) return
    // Ours is applied when its epoch goes active (everyone can decrypt it by then): that is the switch to send with it.
    if (k.self) return void (c.next = k)
    c.remote.set(k.userId, k)
    await this.keys?.setKey(k.userId, k.keyIndex, k.key)
  }

  private async onEpoch(e: E2eeEpochInfo): Promise<void> {
    const c = this.call
    if (!c || e.channelId !== c.channelId) return
    if (e.state !== 'active') {
      const reason = e.state === 'removed' ? 'Você foi removido da chamada criptografada.' : `A criptografia de ponta a ponta falhou (${e.reason ?? 'erro'}).`
      c.active = false
      // A join in progress fails with it (connect() closes); a live call is closed here.
      if (this.e2eeWaiters.size) for (const w of [...this.e2eeWaiters]) w(reason)
      else await this.failClosed(reason, e.state !== 'removed')
      return
    }
    const own = c.next?.epoch === e.epoch ? c.next : null
    if (own && own !== c.own) {
      c.own = own
      await this.keys?.setKey(own.userId, own.keyIndex, own.key)
    }
    if (this.call !== c) return
    c.active = true
    patch('e2ee', { state: 'active', epoch: e.epoch, members: e.members })
    for (const w of [...this.e2eeWaiters]) w(null)
  }

  /** Leave the call's MLS group and drop its keys and cryptor (leave, terminal disconnect, another channel). */
  private endE2ee(): void {
    const c = this.call
    this.call = null
    if (c) void bridge()?.e2ee?.leaveCall(c.channelId).catch(() => undefined)
    for (const w of [...this.e2eeWaiters]) w('A chamada foi encerrada.')
    this.cryptor?.terminate()
    this.cryptor = null
    this.keys = null
    this.mismatchSince.clear()
  }

  /** E2EE expected and not there: leave, no automatic rejoin, say why. Media is never sent unencrypted instead. */
  private async failClosed(reason: string, failure = true): Promise<void> {
    this.userLeft = true
    this.clearRejoin()
    const room = this.room
    this.room = null
    this.endE2ee()
    // State first (a join started meanwhile writes after this), then the slow part.
    patch('e2ee', { ...initialState().e2ee, state: 'failed' })
    this.setConn('disconnected', failure ? `${reason} A chamada foi encerrada para não seguir sem criptografia.` : reason)
    if (!room) return
    room.removeAllListeners()
    await this.teardown()
    await room.disconnect(true).catch(() => undefined)
    this.cue('disconnect')
    this.syncTray()
  }

  /** Some track of this participant is unencrypted: LiveKit would pass its frames through as is, so none is played. */
  private plaintext(rp: RemoteParticipant): boolean {
    return !!this.call && [...rp.trackPublications.values()].some((p) => !p.isEncrypted)
  }

  // ───────────────────────────── participants ─────────────────────────────

  private addRemote(rp: RemoteParticipant): void {
    for (const pub of rp.trackPublications.values()) this.onRemotePublished(pub, rp)
    this.applyVolume(rp.identity)
  }

  private onRemotePublished(pub: RemoteTrackPublication, rp: RemoteParticipant): void {
    if (this.plaintext(rp)) {
      for (const p of rp.trackPublications.values()) if (p.isSubscribed) p.setSubscribed(false)
      return
    }
    if (pub.source === Track.Source.Microphone) {
      pub.setSubscribed(true)
      this.syncCodecSoon() // its name carries what this participant decodes
    } else if (pub.source === Track.Source.ScreenShare) {
      if (!useMedia.getState().participants[rp.identity]?.streaming) this.cue('streamStart') // not on a republish
      if (useMedia.getState().viewers[rp.identity]?.subscribed) this.watch(rp.identity, useMedia.getState().viewers[rp.identity]!.quality)
    }
  }

  private onSubscribed(track: RemoteTrack, pub: RemoteTrackPublication, rp: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach()
      el.style.display = 'none'
      document.body.appendChild(el)
      this.audioEls.add(el)
      this.applyVolume(rp.identity)
      if (pub.source === Track.Source.Microphone) this.addMeter(rp.identity, track.mediaStreamTrack)
    } else if (pub.source === Track.Source.ScreenShare) {
      if (this.room) this.room.options.adaptiveStream = ADAPTIVE
      const els = [...(this.viewerEls.get(rp.identity) ?? [])]
      // Republish: take the elements off the old publication first (its later detach would reload them).
      for (const p of rp.trackPublications.values()) if (p !== pub && p.source === Track.Source.ScreenShare) for (const el of els) p.track?.detach(el)
      for (const el of els) track.attach(el)
    }
  }

  private applyVolume(identity: string): void {
    const rp = this.room?.remoteParticipants.get(identity)
    if (!rp) return
    const s = useMedia.getState()
    const local = s.participants[identity]?.locallyMuted ?? false
    rp.setVolume(s.self.deafened || local ? 0 : this.prefs.volumeOf(identity), Track.Source.Microphone)
    rp.setVolume(s.self.deafened ? 0 : this.prefs.streamVolumeOf(identity), Track.Source.ScreenShareAudio)
  }

  /** Per-user playback volume, 0..2 (persisted by userId = LiveKit identity). */
  setVolume(identity: string, volume: number): void {
    const v = this.prefs.setVolume(identity, volume)
    this.updateParticipant(identity, { volume: v })
    this.applyVolume(identity)
  }

  /** Mute someone only for me. */
  setLocalMute(identity: string, muted: boolean): void {
    this.updateParticipant(identity, { locallyMuted: muted })
    this.applyVolume(identity)
  }

  private updateParticipant(identity: string, p: Partial<ParticipantView>): void {
    useMedia.setState((s) => {
      const cur = s.participants[identity]
      return cur ? { participants: { ...s.participants, [identity]: { ...cur, ...p } } } : {}
    })
  }

  // ───────────────────────────── mute / deafen / input modes ─────────────────────────────

  async setMuted(muted: boolean, cue = true): Promise<void> {
    this.start()
    const s = useMedia.getState().self
    if (!muted && s.deafened) return this.setDeafened(false)
    if (s.muted === muted) return
    patch('self', { muted })
    if (this.mic) await (muted ? this.mic.mute() : this.mic.unmute())
    if (cue) this.cue(muted ? 'mute' : 'unmute')
    this.syncTray()
  }
  toggleMute(): Promise<void> {
    return this.setMuted(!useMedia.getState().self.muted)
  }

  /** Deafen = silence every remote stream and the mic; undeafen restores the previous mute state. */
  async setDeafened(deafened: boolean): Promise<void> {
    this.start()
    const s = useMedia.getState().self
    if (s.deafened === deafened) return
    if (deafened) this.mutedBeforeDeafen = s.muted
    patch('self', { deafened, muted: deafened ? true : this.mutedBeforeDeafen })
    if (this.mic) await (deafened || this.mutedBeforeDeafen ? this.mic.mute() : this.mic.unmute())
    for (const id of this.room?.remoteParticipants.keys() ?? []) this.applyVolume(id)
    this.cue(deafened ? 'deafen' : 'undeafen')
    this.syncTray()
  }
  toggleDeafen(): Promise<void> {
    return this.setDeafened(!useMedia.getState().self.deafened)
  }

  setInputMode(mode: InputMode): void {
    this.start()
    this.prefs.set({ inputMode: mode })
    patch('self', { inputMode: mode })
    this.applyGate()
  }

  /** Manual VAD threshold in dBFS (-100..0), or null for automatic. */
  setSensitivity(db: number | null): void {
    this.start()
    const v = db === null ? null : Math.max(-100, Math.min(0, db))
    this.prefs.set({ sensitivityDb: v })
    patch('self', { sensitivityDb: v })
    this.applyGate()
  }

  setPttReleaseDelay(ms: number): void {
    this.ptt.delayMs = Math.max(0, Math.min(1000, ms))
    this.prefs.set({ pttReleaseMs: this.ptt.delayMs })
    patch('self', { pttReleaseMs: this.ptt.delayMs })
  }

  pttDown(): void {
    if (this.pttTimer) clearTimeout(this.pttTimer)
    this.ptt.down()
    patch('self', { pttPressed: true })
    this.applyGate()
  }

  pttUp(): void {
    this.ptt.up(performance.now())
    if (this.pttTimer) clearTimeout(this.pttTimer)
    this.pttTimer = setTimeout(() => {
      this.ptt.isOpen(performance.now())
      patch('self', { pttPressed: this.ptt.pressed })
      this.applyGate()
    }, this.ptt.delayMs)
  }

  private onHotkey(action: string, phase: 'down' | 'up'): void {
    if (action === 'pushToTalk') {
      if (useMedia.getState().self.inputMode === 'ptt') phase === 'down' ? this.pttDown() : this.pttUp()
    } else if (action === 'pushToMute') {
      if (phase === 'down' && !useMedia.getState().self.muted) {
        this.ptmActive = true
        void this.setMuted(true, false)
      } else if (phase === 'up' && this.ptmActive) {
        this.ptmActive = false
        void this.setMuted(false, false)
      }
    } else if (phase === 'down' && action === 'toggleMute') void this.toggleMute()
    else if (phase === 'down' && action === 'toggleDeafen') void this.toggleDeafen()
  }

  private applyGate(): void {
    const p = this.prefs.get()
    for (const g of [this.graph, this.test.graph]) {
      if (!g) continue
      g.setGate(p.sensitivityDb, 300)
      g.setMode(p.inputMode === 'vad' ? 'vad' : 'forced', this.ptt.pressed)
    }
  }

  private onGateReport(r: GateReport): void {
    const s = useMedia.getState().self
    const lin = Math.min(1, Math.max(0, (r.db + 60) / 60))
    // Fast attack, ~300 ms decay: readable meter without flicker.
    this.levelSmooth = lin > this.levelSmooth ? lin : this.levelSmooth * 0.85 + lin * 0.15
    const speaking = r.open && !s.muted && !s.deafened && r.db > r.thresholdDb - 6
    patch('self', { level: this.levelSmooth, levelDb: r.db, thresholdDb: r.thresholdDb, gateOpen: r.open, speaking })
  }

  // ───────────────────────────── processing ─────────────────────────────

  /** Padrão (Chromium APM) / Supressão avançada (RNNoise) / Desligado (raw). Hot-switchable. */
  async setProcessing(mode: ProcessingMode): Promise<void> {
    this.start()
    this.prefs.set({ processing: mode })
    patch('self', { processing: mode })
    if (this.mic) {
      await this.mic.restartTrack(captureConstraints(mode, this.activeInput))
      await this.applyRnnoise(mode)
    } else if (this.test.graph) {
      await this.startMicTest({ loopback: useMedia.getState().micTest.loopback })
    }
  }

  private async applyRnnoise(mode: ProcessingMode, graph = this.graph): Promise<void> {
    if (!graph) return
    try {
      await graph.setRnnoise(mode === 'advanced')
      patch('self', { processingActive: mode })
    } catch (e) {
      patch('self', { processingActive: 'standard' })
      this.notify(`Supressão avançada indisponível (${errText(e)}). Usando o processamento padrão.`)
      if (graph === this.graph && this.mic) await this.mic.restartTrack(captureConstraints('standard', this.activeInput))
    }
  }

  // ───────────────────────────── devices ─────────────────────────────

  async refreshDevices(reconcile = true): Promise<void> {
    this.start()
    let list: MediaDeviceInfo[] = []
    try {
      list = await navigator.mediaDevices.enumerateDevices()
    } catch {
      return
    }
    const map = (kind: MediaDeviceKind): DeviceInfo[] =>
      // Chromium's "default"/"communications" aliases are what `null` (system default) already means.
      list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}` }))
    const inputs = map('audioinput')
    const outputs = map('audiooutput')
    patch('devices', { inputs, outputs })
    if (reconcile) await this.reconcileDevices(inputs, outputs)
  }

  /** Unplugged preferred device -> system default + notice; replugged -> back to preferred. */
  private async reconcileDevices(inputs: DeviceInfo[], outputs: DeviceInfo[]): Promise<void> {
    const p = this.prefs.get()
    const label = (l: DeviceInfo[], id: string) => l.find((d) => d.deviceId === id)?.label ?? id
    if (p.inputDeviceId) {
      const present = inputs.some((d) => d.deviceId === p.inputDeviceId)
      if (!present && this.activeInput === p.inputDeviceId) {
        this.activeInput = null
        this.notify('Microfone desconectado. Usando o microfone padrão do sistema.')
        await this.switchInput(null)
      } else if (present && this.activeInput !== p.inputDeviceId) {
        this.activeInput = p.inputDeviceId
        this.notify(`${label(inputs, p.inputDeviceId)} reconectado.`)
        await this.switchInput(p.inputDeviceId)
      }
    }
    if (p.outputDeviceId) {
      const present = outputs.some((d) => d.deviceId === p.outputDeviceId)
      if (!present && this.activeOutput === p.outputDeviceId) {
        this.activeOutput = null
        this.notify('Saída de áudio desconectada. Usando a saída padrão do sistema.')
        await this.switchOutput(null)
      } else if (present && this.activeOutput !== p.outputDeviceId) {
        this.activeOutput = p.outputDeviceId
        this.notify(`${label(outputs, p.outputDeviceId)} reconectado.`)
        await this.switchOutput(p.outputDeviceId)
      }
    }
  }

  /** User picks a mic (null = system default). Applies live during a call. */
  async setInputDevice(deviceId: string | null): Promise<void> {
    this.start()
    this.prefs.set({ inputDeviceId: deviceId })
    this.activeInput = deviceId
    await this.switchInput(deviceId)
  }

  async setOutputDevice(deviceId: string | null): Promise<void> {
    this.start()
    this.prefs.set({ outputDeviceId: deviceId })
    this.activeOutput = deviceId
    await this.switchOutput(deviceId)
  }

  private async switchInput(id: string | null): Promise<void> {
    patch('devices', { inputId: id })
    try {
      if (this.room && this.mic) await this.room.switchActiveDevice('audioinput', id ?? 'default')
      else if (this.test.graph) await this.startMicTest({ loopback: useMedia.getState().micTest.loopback })
    } catch (e) {
      this.notify(`Não foi possível usar este microfone: ${errText(e)}`)
    }
  }

  private async switchOutput(id: string | null): Promise<void> {
    patch('devices', { outputId: id })
    setCueOutput(id)
    try {
      if (this.room) await this.room.switchActiveDevice('audiooutput', id ?? 'default')
      const el = this.test.el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
      await el?.setSinkId?.(id ?? '')
    } catch (e) {
      this.notify(`Não foi possível usar esta saída: ${errText(e)}`)
    }
  }

  // ───────────────────────────── mic test ─────────────────────────────

  /** Level meter (useMedia.self.level) + optional hear-yourself. Works in or out of a call. */
  async startMicTest(opts: { loopback: boolean }): Promise<void> {
    this.start()
    await this.stopMicTest()
    patch('micTest', { active: true, loopback: opts.loopback })
    if (this.graph) {
      if (opts.loopback) this.startLoopback(this.graph.output)
      return
    }
    const p = this.prefs.get()
    const c = captureConstraints(p.processing, this.activeInput)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: toConstraints(c) })
    const graph = new VoiceGraph({ rnnoise: false, onReport: (r) => this.onGateReport(r) })
    this.test = { graph, stream, el: null }
    await graph.setInput(stream.getAudioTracks()[0]!)
    this.applyGate()
    await this.applyRnnoise(p.processing, graph)
    if (opts.loopback) this.startLoopback(graph.output)
    void this.refreshDevices(false)
  }

  async stopMicTest(): Promise<void> {
    this.stopLoopback()
    this.test.stream?.getTracks().forEach((t) => t.stop())
    await this.test.graph?.close()
    this.test = { graph: null, stream: null, el: null }
    patch('micTest', { active: false })
    if (!this.graph) patch('self', { level: 0, gateOpen: false, speaking: false })
  }

  private startLoopback(track: MediaStreamTrack): void {
    const el = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    el.srcObject = new MediaStream([track])
    void el.setSinkId?.(this.activeOutput ?? '').catch(() => undefined)
    void el.play().catch(() => undefined)
    this.test.el = el
  }

  private stopLoopback(): void {
    if (!this.test.el) return
    this.test.el.pause()
    this.test.el.srcObject = null
    this.test.el = null
  }

  // ───────────────────────────── screen share (publisher) ─────────────────────────────

  getScreenSources() {
    return bridge()?.screen?.getSources?.(['screen', 'window']) ?? Promise.resolve([])
  }

  private async capture(sourceId: string | null | undefined, audio: boolean, preset: ScreenPreset): Promise<MediaStream> {
    const screen = bridge()?.screen
    const open = async (width: number, height: number) => {
      // Without the native picker (bridge not ready) getDisplayMedia uses whatever handler main installed.
      if (screen?.select && sourceId) await screen.select(sourceId, { audio })
      return navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: width }, height: { max: height }, frameRate: { ideal: preset.fps, max: preset.fps } },
        // restrictOwnAudio: loopback without our own process tree, so viewers don't hear the call echoed (decision 0002).
        audio: audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true } : false,
        systemAudio: audio ? 'include' : 'exclude',
        selfBrowserSurface: 'exclude',
      } as DisplayMediaStreamOptions)
    }
    const stream = await open(preset.width, preset.height)
    // A source smaller than the preset (most windows) arrives inside capture buffers of the preset's size
    // (getSettings() reports that size, not the frame's). The HEVC hardware encoder can't start on those and
    // WebRTC silently switches the sender to VP8, which the SFU drops (docs/benchmarks/media-baseline.md §4).
    // Capture again at the real size.
    const track = stream.getVideoTracks()[0]
    const set = track?.getSettings()
    const real = track && set?.width && set.height ? await frameSize(track) : null
    if (real) frameSizes.set(track!, real)
    if (!real || (real.width >= set!.width! && real.height >= set!.height!)) return stream
    stream.getTracks().forEach((t) => t.stop())
    // Multiple of 8: the /4 and /2 simulcast layers (presets.simulcastFor) stay even, as the HW encoder needs.
    const again = await open(real.width & ~1, real.height & ~1)
    const t2 = again.getVideoTracks()[0]
    if (t2) frameSizes.set(t2, { width: real.width & ~1, height: real.height & ~1 })
    return again
  }

  async startScreenShare(opts: ScreenShareOptions = {}): Promise<void> {
    this.start()
    const room = this.room
    if (!room) throw new Error('Entre em um canal de voz antes de transmitir.')
    if (this.call && !this.call.active) throw new Error('A criptografia da chamada ainda não está pronta.')
    if (this.screenPub) await this.stopScreenShare(true)
    const p = this.prefs.get()
    const contentType = opts.contentType ?? p.contentType
    // Never above what the plan allows and this machine sustains; the wish is kept so an upgrade can lift the cap.
    const want = opts.quality ?? p.screenPreset
    const preset = clampPreset(want, useMedia.getState().screen.offered, contentType)
    const codec = opts.codec ?? useMedia.getState().screen.codec
    const audio = opts.audio ?? false
    this.prefs.set({ screenPreset: want, contentType, ...(opts.codec && { codec: opts.codec }) })
    patch('screen', { preset: preset.id, contentType, codec, audio, error: null })
    let stream: MediaStream
    try {
      stream = opts.stream ?? (await this.capture(opts.sourceId, audio, preset))
    } catch (e) {
      patch('screen', { error: `Captura cancelada ou indisponível: ${errText(e)}` })
      throw e
    }
    try {
      // What the room can take (decode lists, E2EE has no backup codec) and what the layers allow (HEVC_MIN_SIDE).
      const live = this.shareCodec(codec, preset, stream.getVideoTracks()[0]!)
      const top = this.presetFor(live, preset)
      if (top !== preset) {
        const v = stream.getVideoTracks()[0]!
        await v.applyConstraints({ width: { max: top.width }, height: { max: top.height }, frameRate: { ideal: top.fps, max: top.fps } }).catch(() => undefined)
        frameSizes.set(v, fit(sizeOf(v), top))
      }
      const pub = await this.publishScreen(room, stream, top, contentType, live)
      this.screenPub = { ...pub, preset: top, declared: top, cpuLimited: [], sourceId: opts.sourceId ?? null, codec: live, want: codec }
      if (top !== preset) patch('screen', { preset: top.id })
      for (const el of this.ownEls) pub.video.track?.attach(el)
      patch('screen', { active: true, sourceId: opts.sourceId ?? null })
      this.cue('streamStart')
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      patch('screen', { error: `Falha ao publicar a transmissão: ${errText(e)}` })
      throw e
    }
  }

  private async publishScreen(room: Room, stream: MediaStream, preset: ScreenPreset, contentType: ContentType, codec: VideoCodecId) {
    const vpub = await this.publishScreenVideo(room, stream.getVideoTracks()[0]!, preset, contentType, codec)
    const a = stream.getAudioTracks()[0]
    const apub = a
      ? await room.localParticipant.publishTrack(a, { source: Track.Source.ScreenShareAudio, name: 'screen_audio', dtx: false, red: true, forceStereo: true, audioPreset: AudioPresets.musicHighQualityStereo })
      : null
    return { video: vpub, audio: apub }
  }

  private publishScreenVideo(room: Room, video: MediaStreamTrack, preset: ScreenPreset, contentType: ContentType, codec: VideoCodecId): Promise<LocalTrackPublication> {
    const { hint, degradation } = contentSettings(contentType)
    video.contentHint = hint
    video.addEventListener('ended', () => void this.stopScreenShare())
    const size = sizeOf(video)
    const svc = codec === 'vp9' || codec === 'av1'
    return room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      name: 'screen',
      videoCodec: codec,
      ...layerOptions(preset, size.width, size.height, codec),
      simulcast: true,
      scalabilityMode: svc ? 'L3T3_KEY' : undefined,
      degradationPreference: degradation,
    })
  }

  /** Change what is being captured without stopping the stream (viewers stay subscribed). */
  async switchScreenSource(sourceId: string): Promise<void> {
    const cur = this.screenPub
    const room = this.room
    if (!cur || !room) throw new Error('Nenhuma transmissão ativa.')
    const audio = useMedia.getState().screen.audio
    const stream = await this.capture(sourceId, audio, cur.preset)
    const video = stream.getVideoTracks()[0]!
    const vtrack = cur.video.track as LocalVideoTrack
    const old = vtrack.mediaStreamTrack
    video.contentHint = old.contentHint
    video.addEventListener('ended', () => void this.stopScreenShare())
    await vtrack.replaceTrack(video, true)
    old.stop()
    cur.sourceId = sourceId
    const a = stream.getAudioTracks()[0]
    if (a && cur.audio?.track) {
      const oldA = cur.audio.track.mediaStreamTrack
      await cur.audio.track.replaceTrack(a, true)
      oldA.stop()
    } else if (a) {
      cur.audio = await room.localParticipant.publishTrack(a, { source: Track.Source.ScreenShareAudio, name: 'screen_audio', dtx: false, red: true, forceStereo: true, audioPreset: AudioPresets.musicHighQualityStereo })
    }
    patch('screen', { sourceId })
  }

  async stopScreenShare(silent = false): Promise<void> {
    const cur = this.screenPub
    if (!cur) return
    this.screenPub = null
    for (const el of this.ownEls) cur.video.track?.detach(el)
    await this.dropScreenTracks(this.room, [cur.video, cur.audio])
    // The sustain record is per preset for the machine's codec: a share the room moved to another codec says nothing about it.
    if (cur.cpuLimited.length >= 10 && cur.codec === useMedia.getState().screen.codec) {
      this.prefs.set({ encoderSustain: recordSustain(this.prefs.get().encoderSustain, cur.preset.id, cur.cpuLimited) })
      void this.probeEncoder()
    }
    patch('screen', { active: false, stats: null, sourceId: null })
    if (!silent) this.cue('streamStop')
  }

  /**
   * Unpublish screen publications and free their encoders. LiveKit's unpublish only makes the transceivers inactive.
   * Chromium keeps their send streams, and with them every encoder instance (3 simulcast layers + backup codec), for
   * the life of the connection: +39 MB per share with OpenH264, +165 MB with VP9 (docs/benchmarks/media-baseline.md
   * §4). Stopping the transceivers releases them.
   */
  private async dropScreenTracks(room: Room | null, pubs: (LocalTrackPublication | null)[]): Promise<void> {
    const tracks = pubs.map((p) => p?.track).filter((t) => !!t)
    const senders = new Set(tracks.flatMap((t) => [t.sender, ...('simulcastCodecs' in t ? [...(t as LocalVideoTrack).simulcastCodecs.values()].map((c) => c.sender) : [])]))
    const transceivers = room?.engine.pcManager?.publisher.getTransceivers().filter((t) => senders.has(t.sender)) ?? []
    for (const track of tracks) {
      track.stop()
      await room?.localParticipant.unpublishTrack(track, true).catch(() => undefined)
    }
    if (room && transceivers.length) await releaseTransceivers(room, transceivers)
  }

  /** Hardware encoder probe per codec -> automatic codec + which presets this machine can sustain. */
  private async probeEncoder(): Promise<void> {
    const hw: Partial<Record<VideoCodecId, boolean>> = {}
    for (const c of ['h265', 'h264'] as const) {
      try {
        const info = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType: MIME[c], width: 1920, height: 1080, framerate: 60, bitrate: 8_000_000 },
        })
        hw[c] = info.supported && info.powerEfficient
      } catch {
        hw[c] = false
      }
    }
    this.hw = hw
    const chosen = this.prefs.get().codec
    const codec = chosen ?? pickCodec(hw)
    const hardware = hw[codec] ?? false
    this.capable = availablePresets(
      { hardware, sourceWidth: Math.round(screen.width * devicePixelRatio), sourceHeight: Math.round(screen.height * devicePixelRatio) },
      this.prefs.get().encoderSustain,
    )
    patch('screen', { codec, codecAuto: !chosen, hardwareEncoder: hardware })
    this.syncPlan()
  }

  /**
   * Screen-share presets the user's plan allows (Me.plan.streamPresets, VoiceJoinResponse.streamPresets or the
   * token attribute); null = unknown. During a share the live stream is re-capped down, or lifted back, in place.
   */
  setPlanPresets(list: readonly string[] | null): void {
    const next = list ? list.filter(isPresetId) : null
    if (String(next) === String(this.plan) && (next === null) === (this.plan === null)) return
    this.plan = next
    // Called at boot from the plan: don't start the engine (devices + encoder probe cost ~70 MB idle); start() syncs.
    if (this.started) this.syncPlan()
  }

  private planFromRoom(room: Room): void {
    const raw = room.localParticipant.attributes?.[STREAM_PRESETS_ATTRIBUTE]
    if (raw !== undefined) this.setPlanPresets(raw.split(','))
  }

  /** offered/locked = machine × plan. A live share above the result is re-capped; one capped earlier is lifted back. */
  private syncPlan(): void {
    const { offered, locked } = gatePresets(this.capable, this.plan)
    const target = clampPreset(this.prefs.get().screenPreset, offered, useMedia.getState().screen.contentType)
    patch('screen', { offered, locked, plan: this.plan, ...(!this.screenPub && { preset: target.id }) })
    const cur = this.screenPub
    if (!cur) return
    // Declared above the new plan: the server mutes it PLAN_RECHECK_MS (10 s) after the change, re-capped or not.
    const republish = aboveContract(cur.declared, this.plan)
    const live = cur.preset
    if (live.id === target.id && !republish) return
    // Say it once, calmly: the stream keeps going, only its ceiling moved.
    if (live.id !== target.id) this.notify(offered.some((p) => p.id === live.id) ? `A transmissão agora vai em ${target.label}.` : `Seu plano não inclui ${live.label}: a transmissão continua, em ${target.label}.`)
    void (republish ? this.republish(target) : this.recap(target))
  }

  /** Quality of the live share (applied in place, viewers stay) or of the next one. */
  async setScreenQuality(id: ScreenPresetId): Promise<void> {
    this.start()
    this.prefs.set({ screenPreset: id })
    const s = useMedia.getState().screen
    const target = clampPreset(id, s.offered, s.contentType)
    if (!this.screenPub) return patch('screen', { preset: target.id })
    await this.recap(target)
  }

  /**
   * Re-cap the live share in place. Same publication (viewers stay subscribed); a new capture of the same source
   * at the new size/fps is swapped in with replaceTrack (like switchScreenSource), then every encoding of every
   * sender (simulcast layers + backup codec) is rewritten for the new ladder. The SFU keeps the layer list declared
   * at publish; what goes on the wire follows the new caps right away.
   */
  private recap(preset: ScreenPreset): Promise<void> {
    // The hardware encoder keeps the frame rate it was started with: 30 → 60 fps in place stayed at 30 fps with
    // maxFramerate 60, 47 fps captured and no limitation (NVENC HEVC, QA BUG-03). More fps needs a fresh encoder,
    // so that one is a republish (viewers follow it, ~0.2–0.5 s of rebuffer).
    if (this.screenPub && preset.fps > this.screenPub.preset.fps) return this.republish(preset)
    const run = async () => {
      const cur = this.screenPub
      if (!cur || !this.room || cur.preset.id === preset.id) return
      const vtrack = cur.video.track as LocalVideoTrack
      const codec = cur.codec
      let video = vtrack.mediaStreamTrack
      if (cur.sourceId) {
        // Chromium shares one capture device per source: a second capture of it only gets frames up to the size/fps
        // the first one runs at (measured: 720p → 1080p stayed 1280×720). Going up, raise the live track first.
        if (preset.height > cur.preset.height || preset.fps > cur.preset.fps) {
          await video.applyConstraints({ width: { max: preset.width }, height: { max: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } }).catch(() => undefined)
        }
        const stream = await this.capture(cur.sourceId, false, preset)
        if (this.screenPub !== cur) return stream.getTracks().forEach((t) => t.stop())
        const old = video
        video = stream.getVideoTracks()[0]!
        // No frame within capture()'s probe (a second capture of a live source can be slow): same source, so the live
        // one's size, fitted to the preset. getSettings() would give the capture buffer and a ladder for the wrong size
        // (measured: 240×135 layers of a 960×540 window, below what an HEVC decoder takes).
        if (!frameSizes.has(video)) frameSizes.set(video, fit(sizeOf(old), preset))
        video.contentHint = old.contentHint
        video.addEventListener('ended', () => void this.stopScreenShare())
        const size = sizeOf(video)
        // replaceTrack recomputes encodings from publishOptions when the size changes: hand it the new ladder first.
        vtrack.publishOptions = { ...vtrack.publishOptions, ...layerOptions(preset, size.width, size.height, codec) }
        await vtrack.replaceTrack(video, true)
        old.stop()
      } else {
        // An injected stream (lab patterns): only the frame rate can follow, the encoder caps below do the rest.
        await video.applyConstraints({ frameRate: { ideal: preset.fps, max: preset.fps } }).catch(() => undefined)
      }
      const size = sizeOf(video)
      vtrack.publishOptions = { ...vtrack.publishOptions, ...layerOptions(preset, size.width, size.height, codec) }
      await applyEncodings(vtrack, preset, size.width ?? preset.width, size.height ?? preset.height)
      cur.preset = preset
      cur.cpuLimited = []
      patch('screen', { preset: preset.id })
      this.syncCodecSoon() // the new ladder may not suit the codec (HEVC_MIN_SIDE)
    }
    return this.queueRecap(run)
  }

  /**
   * Plan downgrade below what the share declared: the SFU keeps a publication's declared layers, so an in-place
   * re-cap would still be muted by the server's re-check. Publish the same source again at `preset` (a fresh capture
   * of it, no picker; system audio stays published as is), then drop the old video publication. Viewers follow the
   * new one (onRemotePublished / onSubscribed) without going back to "Assistir".
   */
  private republish(preset: ScreenPreset, codec = this.screenPub?.codec): Promise<void> {
    const run = async () => {
      const cur = this.screenPub
      const room = this.room
      if (!cur || !room) return
      const old = cur.video
      const s = useMedia.getState().screen
      const live = codec ?? cur.codec
      let video: MediaStreamTrack
      if (cur.sourceId) {
        // Same as recap(): the live capture of this source caps a new one at its own size/fps; raise it first.
        if (preset.height > cur.preset.height || preset.fps > cur.preset.fps) {
          await old.track?.mediaStreamTrack.applyConstraints({ width: { max: preset.width }, height: { max: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } }).catch(() => undefined)
        }
        video = (await this.capture(cur.sourceId, false, preset)).getVideoTracks()[0]!
      }
      else {
        // Injected stream or no picker bridge: a clone of the live capture (same source, nothing to pick).
        video = old.track!.mediaStreamTrack.clone()
        await video.applyConstraints({ width: { max: preset.width }, height: { max: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } }).catch(() => undefined)
      }
      if (this.screenPub !== cur || this.room !== room) return video.stop()
      let vpub: LocalTrackPublication
      try {
        vpub = await this.publishScreenVideo(room, video, preset, s.contentType, live)
      } catch (e) {
        video.stop()
        throw e
      }
      // Stopped or left meanwhile: the new publication goes too.
      if (this.screenPub !== cur || this.room !== room) return this.dropScreenTracks(room, [vpub])
      for (const el of this.ownEls) old.track?.detach(el), vpub.track?.attach(el)
      Object.assign(cur, { video: vpub, preset, declared: preset, cpuLimited: [], codec: live })
      patch('screen', { preset: preset.id })
      // The SFU announces the new track only once its media flows: dropped earlier, viewers saw the share end
      // (measured). Wait for the first viewer to move over, or REPUBLISH_OVERLAP_MS when nobody watches.
      await new Promise<void>((resolve) => {
        const done = (p?: LocalTrackPublication) => {
          if (p && p.trackSid !== vpub.trackSid) return
          clearTimeout(t)
          room.off(RoomEvent.LocalTrackSubscribed, done)
          resolve()
        }
        const t = setTimeout(done, REPUBLISH_OVERLAP_MS)
        room.on(RoomEvent.LocalTrackSubscribed, done)
      })
      await this.dropScreenTracks(room, [old])
    }
    return this.queueRecap(run)
  }

  /** Codecs this client decodes (RTCRtpReceiver capabilities, minus what failed at runtime): what senders read. */
  private decodeCaps(): VideoCodecId[] {
    const mimes = typeof RTCRtpReceiver === 'undefined' ? [] : (RTCRtpReceiver.getCapabilities('video')?.codecs.map((c) => c.mimeType) ?? [])
    return decodable(mimes).filter((c) => !this.brokenDecoders.has(c))
  }

  /** The codec a share at `preset` goes out in: `want`, unless a layer or someone in the call can't take it (roomCodec). */
  private shareCodec(want: VideoCodecId, preset: ScreenPreset, video: MediaStreamTrack): VideoCodecId {
    const { width = preset.width, height = preset.height } = sizeOf(video)
    const members = this.call ? new Set(useMedia.getState().e2ee.members.map((m) => m.userId)) : null
    // Under E2EE only MLS members count: someone without keys can't watch anyway (and must not force a codec).
    const viewers = [...(this.room?.remoteParticipants.values() ?? [])].filter((rp) => !members || members.has(rp.identity))
    const caps = viewers.map((rp) => peerDecode(rp.attributes[DECODE_ATTRIBUTE], rp.getTrackPublication(Track.Source.Microphone)?.trackName))
    return roomCodec(want, [...simulcastFor(preset, width, height), { width, height }], caps, !!this.call, this.hevcMinSide)
  }

  /** A codec the room forced on us that has no hardware encoder here: the software ceiling (0001 §6), not `preset`. */
  private presetFor(codec: VideoCodecId, preset: ScreenPreset): ScreenPreset {
    if (codec === useMedia.getState().screen.codec || this.hw[codec]) return preset
    const soft = gatePresets(availablePresets({ hardware: false }, this.prefs.get().encoderSustain), this.plan).offered
    return clampPreset(preset.id, soft, useMedia.getState().screen.contentType)
  }

  /** Someone joined, left or re-advertised: a live share whose codec no longer fits the call is republished in it. */
  private syncCodecSoon(): void {
    if (!this.screenPub) return
    if (this.codecTimer) clearTimeout(this.codecTimer)
    this.codecTimer = setTimeout(() => {
      this.codecTimer = null
      const cur = this.screenPub
      const video = cur?.video.track?.mediaStreamTrack
      if (!cur || !video || !this.room) return
      const s = useMedia.getState().screen
      // The wish (pref within plan × machine), not the live preset: a share capped for software H.264 goes back up.
      const base = clampPreset(this.prefs.get().screenPreset, s.offered, s.contentType)
      const codec = this.shareCodec(cur.want, base, video)
      const preset = this.presetFor(codec, base)
      if (codec !== cur.codec || (codec !== cur.want && preset.id !== cur.preset.id)) void this.republish(preset, codec)
    }, CODEC_SETTLE_MS)
  }

  /** Viewer side: a stream we can't decode (HEVC fell back to a null decoder) → stop advertising that codec. */
  private decodeFailed(codec: VideoCodecId): void {
    if (codec === 'h264' || this.brokenDecoders.has(codec)) return
    this.brokenDecoders.add(codec)
    const room = this.room
    // The mic's name carries the list: publish it again (a short gap in our voice) so senders republish in H.264.
    // shortcut: listen-only (no mic) can't re-advertise: DECODE_ATTRIBUTE is fixed at /voice/join; upgrade if that bites.
    if (!room || !this.mic) return
    this.micOp = this.micOp.then(async () => {
      if (this.room !== room || !this.mic) return
      await this.dropMic(room)
      if (this.room === room && this.micAllowed(room)) await this.publishMic(room, this.last?.bitrateKbps ?? DEFAULT_KBPS)
    })
  }

  private queueRecap(run: () => Promise<void>): Promise<void> {
    this.recapOp = this.recapOp.then(run, run).catch((e: unknown) => this.notify(`Não foi possível ajustar a qualidade da transmissão: ${errText(e)}`))
    return this.recapOp
  }

  /** `codec: null` returns to automatic. */
  setScreenDefaults(p: { quality?: ScreenPresetId; contentType?: ContentType; codec?: VideoCodecId | null }): void {
    this.start()
    this.prefs.set({ ...(p.quality && { screenPreset: p.quality }), ...(p.contentType && { contentType: p.contentType }), ...(p.codec !== undefined && { codec: p.codec }) })
    patch('screen', { ...(p.contentType && { contentType: p.contentType }) })
    if (p.codec !== undefined) void this.probeEncoder()
    else this.syncPlan()
  }

  // ───────────────────────────── screen share (viewer) ─────────────────────────────

  /** Start receiving someone's stream. Nothing is downloaded for streams nobody watches. */
  watch(identity: string, quality: StreamQuality = 'auto'): void {
    const room = this.room
    const rp = room?.remoteParticipants.get(identity)
    const vpub = screenOf(rp)
    useMedia.setState((s) => ({ viewers: { ...s.viewers, [identity]: { identity, quality, subscribed: true, volume: this.prefs.streamVolumeOf(identity), stats: null } } }))
    if (!room || !vpub || this.plaintext(rp!)) return
    // adaptiveStream is fixed per track at subscription time; "source" subscribes this one track without it.
    if (quality === 'source') room.options.adaptiveStream = false
    this.stalls.delete(identity)
    vpub.setSubscribed(true)
    if (quality === 'source') {
      // livekit-client 2.23 keeps the element size an earlier adaptive subscription of this publication reported and
      // keeps sending it (videoDimensionsAdaptiveStream is never cleared): "Original" got the layer of a small tile
      // (QA BUG-03, measured: 640×360 of a 960×540 share, the top layer paused).
      // shortcut: private field of RemoteTrackPublication; drop once the SDK clears it in setTrack (report upstream).
      const p = vpub as unknown as { videoDimensionsAdaptiveStream?: unknown; emitTrackUpdate?: () => void }
      p.videoDimensionsAdaptiveStream = undefined
      vpub.setVideoQuality(VideoQuality.HIGH)
      p.emitTrackUpdate?.()
    }
    rp?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(true)
    this.applyVolume(identity)
  }

  unwatch(identity: string): void {
    const rp = this.room?.remoteParticipants.get(identity)
    screenOf(rp)?.setSubscribed(false)
    rp?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(false)
    this.deltas.delete(`v:${identity}`)
    this.stalls.delete(identity)
    useMedia.setState((s) => {
      const viewers = { ...s.viewers }
      delete viewers[identity]
      return { viewers }
    })
  }

  /** Re-subscribes with the other mode (brief re-buffer, like any quality switch). */
  async setStreamQuality(identity: string, quality: StreamQuality): Promise<void> {
    const v = useMedia.getState().viewers[identity]
    if (!v || v.quality === quality) return
    const pub = screenOf(this.room?.remoteParticipants.get(identity))
    if (pub?.isSubscribed && this.room) {
      // adaptiveStream is fixed when LiveKit creates the track: re-subscribe only once the old one is really gone.
      // Waiting for any TrackUnsubscribed (or 1.5 s) could re-subscribe first, keep the old element-sized track, and
      // "Original" stayed on the middle layer (QA BUG-03, a busy machine).
      pub.setSubscribed(false)
      for (const t0 = performance.now(); pub.track && performance.now() - t0 < 5000; ) await new Promise((r) => setTimeout(r, 50))
    }
    this.watch(identity, quality)
  }

  setStreamVolume(identity: string, volume: number): void {
    const v = this.prefs.setStreamVolume(identity, volume)
    useMedia.setState((s) => (s.viewers[identity] ? { viewers: { ...s.viewers, [identity]: { ...s.viewers[identity]!, volume: v } } } : {}))
    this.applyVolume(identity)
  }

  /** Render a watched stream into a <video>. Returns a detach function. */
  attachScreen(identity: string, el: HTMLVideoElement): () => void {
    const set = this.viewerEls.get(identity) ?? new Set()
    set.add(el)
    this.viewerEls.set(identity, set)
    const track = screenOf(this.room?.remoteParticipants.get(identity))?.track
    track?.attach(el)
    return () => {
      set.delete(el)
      screenOf(this.room?.remoteParticipants.get(identity))?.track?.detach(el)
    }
  }

  /** Self-preview: render my own outgoing screen into a <video> (call before or during a share). Returns detach. */
  attachOwnScreen(el: HTMLVideoElement): () => void {
    this.ownEls.add(el)
    el.muted = true
    this.screenPub?.video.track?.attach(el)
    return () => {
      this.ownEls.delete(el)
      this.screenPub?.video.track?.detach(el)
    }
  }

  // ───────────────────────────── stats / ui tick ─────────────────────────────

  private startTimers(): void {
    this.stopTimers()
    this.uiTimer = setInterval(() => this.tickUi(), 200)
    this.statsTimer = setInterval(() => void this.tickStats(), 1000)
    this.levelTimer = setInterval(() => this.tickLevels(), LEVEL_TICK_MS)
    this.stallTimer = setInterval(() => void this.tickStalls(), STALL_TICK_MS)
  }
  private stopTimers(): void {
    if (this.uiTimer) clearInterval(this.uiTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.levelTimer) clearInterval(this.levelTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.uiTimer = this.statsTimer = this.levelTimer = this.stallTimer = null
    this.stalls.clear()
    this.undecoded.clear()
  }

  /**
   * Stall guard. When the sender's top layer stops (its uplink can't carry it, WebRTC drops that simulcast layer),
   * the SFU only notices after its screen-share stream tracker times out and the viewer freezes meanwhile: 3.7–4.5 s
   * on a 3 Mbit/s uplink (docs/benchmarks/media-network.md §3). Here: frames stopped while the link still carries
   * data = that layer is gone, so ask the SFU for the next one down now; after a hold, try one back up (the hold
   * doubles while it keeps happening). A dead link (outage) or a still picture (no motion, few fps) is left alone.
   */
  private async tickStalls(): Promise<void> {
    const room = this.room
    if (!room || !this.stallGuard) return
    const now = performance.now()
    for (const id of Object.keys(useMedia.getState().viewers)) {
      const pub = screenOf(room.remoteParticipants.get(id))
      const track = pub?.track
      if (!pub || !track || !pub.isEnabled) {
        this.stalls.delete(id)
        continue
      }
      let frames = 0
      let link = 0
      ;(await track.getRTCStatsReport())?.forEach((s: Record<string, unknown>) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') frames = Number(s.framesDecoded ?? 0)
        else if (s.type === 'candidate-pair' && s.nominated) link += Number(s.bytesReceived ?? 0) + Number(s.responsesReceived ?? 0)
      })
      if (this.room !== room) return
      const next = stallStep(this.stalls.get(id), frames, link, now)
      this.stalls.set(id, next.state)
      if (next.layer !== undefined) pub.setVideoQuality(next.layer as unknown as VideoQuality)
    }
  }

  private addMeter(identity: string, track: MediaStreamTrack): void {
    this.dropMeter(identity)
    // No output device: this context only analyses; playback stays in LiveKit's own graph.
    this.meterCtx ??= new AudioContext({ latencyHint: 'playback', sinkId: { type: 'none' } } as AudioContextOptions)
    void this.meterCtx.resume().catch(() => undefined)
    const an = this.meterCtx.createAnalyser()
    an.fftSize = 2048
    const src = this.meterCtx.createMediaStreamSource(new MediaStream([track]))
    src.connect(an)
    this.meters.set(identity, { src, an, buf: new Float32Array(an.fftSize), level: 0 })
  }

  private dropMeter(identity: string): void {
    const m = this.meters.get(identity)
    if (!m) return
    m.src.disconnect()
    this.meters.delete(identity)
    this.updateParticipant(identity, { level: 0 })
  }

  /** participants[id].level: written only when it moves by >= 0.01, so silence costs no store updates. */
  private tickLevels(): void {
    if (!this.meters.size) return
    const cur = useMedia.getState().participants
    let next: Record<string, ParticipantView> | null = null
    for (const [id, m] of this.meters) {
      m.an.getFloatTimeDomainData(m.buf)
      const inst = perceptualLevel(rmsDb(m.buf))
      // Instant attack, x0.8 per 50 ms tick release (-50 % in ~150 ms): steady glow, no flicker between syllables.
      m.level = inst >= m.level ? inst : Math.max(inst, m.level * 0.8)
      const level = m.level < 0.01 ? 0 : Math.round(m.level * 100) / 100
      const p = cur[id]
      if (p && p.level !== level) (next ??= { ...cur })[id] = { ...p, level }
    }
    if (next) useMedia.setState({ participants: next })
  }

  private tickUi(): void {
    const room = this.room
    if (!room) return
    const prev = useMedia.getState().participants
    const participants: Record<string, ParticipantView> = {}
    for (const rp of room.remoteParticipants.values()) {
      const old = prev[rp.identity]
      const mic = rp.getTrackPublication(Track.Source.Microphone)
      participants[rp.identity] = {
        identity: rp.identity,
        name: rp.name || rp.identity,
        speaking: rp.isSpeaking,
        level: old?.level ?? 0,
        micMuted: !mic || mic.isMuted,
        volume: this.prefs.volumeOf(rp.identity),
        locallyMuted: old?.locallyMuted ?? false,
        streaming: !!rp.getTrackPublication(Track.Source.ScreenShare),
        streamHasAudio: !!rp.getTrackPublication(Track.Source.ScreenShareAudio),
        quality: rp.connectionQuality as Quality,
        audio: old?.audio ?? null,
      }
    }
    useMedia.setState({ participants })
    const quality = room.localParticipant.connectionQuality as Quality
    if (useMedia.getState().self.quality !== quality) patch('self', { quality })
    if (this.call?.active) {
      const e = useMedia.getState().e2ee
      const plain = [...room.remoteParticipants.values()].filter((rp) => this.plaintext(rp)).map((rp) => rp.identity)
      const mismatch = settled(this.mismatchSince, mismatchOf(e.members, room.remoteParticipants.keys(), plain), performance.now())
      if (String(mismatch) !== String(e.mismatch)) patch('e2ee', { mismatch })
    }
  }

  private delta(key: string): StatsDelta {
    let d = this.deltas.get(key)
    if (!d) this.deltas.set(key, (d = new StatsDelta()))
    return d
  }

  private async tickStats(): Promise<void> {
    const room = this.room
    if (!room) return
    const local = this.mic ? audioOut(this.delta('mic').next(await this.mic.getRTCStatsReport())) : null
    const audio: Record<string, ReturnType<typeof audioIn>> = {}
    for (const rp of room.remoteParticipants.values()) {
      const t = rp.getTrackPublication(Track.Source.Microphone)?.track
      if (t) audio[rp.identity] = audioIn(this.delta(`a:${rp.identity}`).next(await t.getRTCStatsReport()))
    }
    let screenStats = null
    if (this.screenPub?.video.track) {
      screenStats = videoOut(this.delta('screen').next(await this.screenPub.video.track.getRTCStatsReport()))
      const top = screenStats?.layers[0]
      if (top && top.fps > 0) this.screenPub.cpuLimited.push(top.qualityLimitationReason === 'cpu')
    }
    const viewers = { ...useMedia.getState().viewers }
    for (const id of Object.keys(viewers)) {
      const t = screenOf(room.remoteParticipants.get(id))?.track
      const v = t ? videoIn(this.delta(`v:${id}`).next(await t.getRTCStatsReport())) : null
      viewers[id] = { ...viewers[id]!, stats: v }
      // Runtime decoder failure (QA BUG-02): Chromium's null decoder, or bytes for 5 s and never a picture.
      const n = v && v.width === 0 && v.bitrateKbps > 100 ? (this.undecoded.get(id) ?? 0) + 1 : 0
      this.undecoded.set(id, n)
      const codec = v?.codec ? decodable([v.codec])[0] : undefined
      if (codec && (v!.decoderImplementation?.includes('NullVideoDecoder') || n >= DECODE_FAIL_TICKS)) this.decodeFailed(codec)
    }
    if (this.room !== room) return
    useMedia.setState((s) => {
      const participants = { ...s.participants }
      for (const [id, a] of Object.entries(audio)) if (participants[id]) participants[id] = { ...participants[id]!, audio: a }
      return { local, participants, viewers }
    })
    patch('screen', { stats: screenStats })
  }

  // ───────────────────────────── misc ─────────────────────────────

  setSoundsEnabled(on: boolean): void {
    this.prefs.set({ sounds: on })
    patch('self', { sounds: on })
    if (!on) stopRing()
  }

  /** Incoming call ring / outgoing ringback (looped, respects the sounds setting); null stops it. */
  ring(kind: RingKind | null): void {
    this.start()
    if (kind && this.prefs.get().sounds) startRing(kind)
    else stopRing()
  }

  private cue(c: Cue): void {
    if (this.prefs.get().sounds) playCue(c)
  }

  private notify(text: string): void {
    useMedia.setState({ notice: { id: ++this.noticeId, text } })
  }

  private syncTray(): void {
    const s = useMedia.getState()
    bridge()?.tray?.setVoiceState?.({ connected: s.connection.state === 'connected', muted: s.self.muted, deafened: s.self.deafened, channelName: this.channelName ?? s.connection.room ?? undefined })
  }

  /** Dev/benchmark access (MediaLab only). Not part of the UI contract. */
  get debug() {
    return { room: this.room, graph: this.graph, mic: this.mic, screen: this.screenPub, prefs: this.prefs, dtxRepairs: this.dtxRepairs, decodeCaps: this.decodeCaps(), brokenDecoders: [...this.brokenDecoders] }
  }
}

/** Newest screen publication of a participant: a republish (plan downgrade) briefly overlaps the old one. */
function screenOf(rp: RemoteParticipant | undefined): RemoteTrackPublication | undefined {
  let last: RemoteTrackPublication | undefined
  for (const p of rp?.trackPublications.values() ?? []) if (p.source === Track.Source.ScreenShare) last = p
  return last
}

/**
 * Free a finished share's encoders: stop its transceivers (an inactive one keeps its send stream and every
 * encoder instance alive). Chromium then recycles the freed m-lines for the next share, and on a recycled
 * m-line LiveKit's SFU (1.13.11) answers its default codec order when it is regressing a viewer to the
 * backup codec: the next share went out as VP8 and nobody received it (measured). So each freed slot is
 * taken right away by an inert placeholder (no track, no encoder), and later shares get fresh m-lines.
 */
async function releaseTransceivers(room: Room, transceivers: RTCRtpTransceiver[]): Promise<void> {
  const pc = room.engine.pcManager?.publisher
  if (!pc) return
  const kinds = transceivers.map((t) => t.receiver.track.kind as 'audio' | 'video')
  for (const t of transceivers) t.stop()
  await room.engine.negotiate().catch(() => undefined)
  // shortcut: placeholders add one m-line per stopped transceiver (as many as before the fix, minus encoders); revisit if SDP size starts to show in negotiation time
  // (measured: ~1.2 MB and 659 → 962 ms renegotiation after 40 plan republishes in one share, media-plan.json republishCycles).
  for (const kind of kinds) pc.addTransceiverOfKind(kind, { direction: 'inactive' })
  await room.engine.negotiate().catch(() => undefined)
}

/** Encoding options of a screen publication for `preset` at the real capture size (top, simulcast ladder, backup codec). */
function layerOptions(preset: ScreenPreset, width: number | undefined, height: number | undefined, codec: VideoCodecId): TrackPublishOptions {
  const advanced = codec === 'vp9' || codec === 'av1' || codec === 'h265'
  return {
    // Codecs not every viewer can decode get an H.264 backup the SFU switches to per subscriber.
    backupCodec: advanced ? { codec: 'h264', encoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.fps } } : false,
    screenShareEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.fps, priority: 'high' },
    screenShareSimulcastLayers: simulcastFor(preset, width, height).map((l) => new VideoPreset(l.width, l.height, l.maxBitrate, l.fps)),
  }
}

/**
 * Rewrite every encoding of a live screen track (primary and backup senders) for `preset` at `w`×`h`: scaled by the
 * short side as LiveKit's computeVideoEncodings does, bitrate and fps capped. Layers dynacast turned off too, so they
 * come back already capped. Under LiveKit's sender lock: dynacast's getParameters/setParameters must not interleave.
 */
async function applyEncodings(track: LocalVideoTrack, preset: ScreenPreset, w: number, h: number): Promise<void> {
  const layers = [...simulcastFor(preset, w, h), { width: w, height: h, fps: preset.fps, maxBitrate: preset.maxBitrate }]
  const short = Math.min(w, h)
  // shortcut: LiveKit 2.23's private senderLock; if a later version drops it we only lose the guard against a concurrent dynacast update.
  const unlock = await (track as unknown as { senderLock?: { lock(): Promise<() => void> } }).senderLock?.lock()
  try {
    for (const sender of [track.sender, ...[...track.simulcastCodecs.values()].map((c) => c.sender)]) {
      if (!sender) continue
      // A sender whose track was just swapped can refuse once ("getParameters() has never been called"): fresh params, retry.
      for (let attempt = 0; ; attempt++) {
        const params = sender.getParameters()
        const enc = params.encodings ?? []
        if (!enc.length) break
        // The encodings published (dynacast toggles them by rid), lowest first: the last one is the top layer.
        enc.forEach((e, i) => {
          const l = layers[Math.max(0, layers.length - enc.length + i)]!
          e.scaleResolutionDownBy = Math.max(1, short / Math.min(l.width, l.height))
          e.maxBitrate = l.maxBitrate
          e.maxFramerate = Math.min(preset.fps, l.fps)
        })
        try {
          await sender.setParameters(params)
          break
        } catch (e) {
          if (attempt >= 2) throw e
          await new Promise((r) => setTimeout(r, 100))
        }
      }
    }
  } finally {
    unlock?.()
  }
}

/** The Opus fmtp the mic's sender negotiated (waits for the answer); null = not known within `ms`. */
async function opusFmtp(track: LocalAudioTrack, ms = 3000): Promise<string | null> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const c = track.sender?.getParameters().codecs?.find((x) => /opus/i.test(x.mimeType))
    if (c) return c.sdpFmtpLine ?? ''
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

/** Real frame size of capture tracks (capture()); getSettings() can report the capture buffer instead. */
const frameSizes = new WeakMap<MediaStreamTrack, { width: number; height: number }>()
const sizeOf = (t: MediaStreamTrack): { width?: number; height?: number } => frameSizes.get(t) ?? t.getSettings()
/** `s` scaled down (never up) to fit `p`, even sides. */
function fit(s: { width?: number; height?: number }, p: Pick<ScreenPreset, 'width' | 'height'>): { width: number; height: number } {
  const w = s.width ?? p.width
  const h = s.height ?? p.height
  const k = Math.min(1, p.width / w, p.height / h)
  return { width: Math.round(w * k) & ~1, height: Math.round(h * k) & ~1 }
}

/** Size of the first real frame (getSettings() can report the capture buffer instead). null = unknown. */
async function frameSize(track: MediaStreamTrack, timeoutMs = 1500): Promise<{ width: number; height: number } | null> {
  type Reader = ReadableStreamDefaultReader<{ displayWidth: number; displayHeight: number; close(): void }>
  const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: { getReader(): Reader } } }).MediaStreamTrackProcessor
  if (!Processor) return null
  const clone = track.clone()
  const reader = new Processor({ track: clone }).readable.getReader()
  try {
    const r = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), timeoutMs))])
    const f = r?.value
    if (!f) return null
    const size = { width: f.displayWidth, height: f.displayHeight }
    f.close()
    return size
  } finally {
    void reader.cancel().catch(() => undefined)
    clone.stop()
  }
}

function toConstraints(c: AudioCaptureOptions): MediaTrackConstraints {
  const { processor: _p, deviceId, ...rest } = c
  return { ...(rest as MediaTrackConstraints), ...(deviceId ? { deviceId: { exact: deviceId as string } } : {}) }
}

export const media = new MediaEngine()
export type { MediaEngine }
