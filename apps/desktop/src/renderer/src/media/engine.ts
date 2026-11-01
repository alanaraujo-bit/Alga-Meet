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
} from 'livekit-client'
import { PttLatch } from './vad'
import { PrefsStore, type InputMode, type ProcessingMode } from './prefs'
import { availablePresets, contentSettings, defaultPreset, getPreset, pickCodec, recordSustain, simulcastFor, type ContentType, type ScreenPreset, type ScreenPresetId, type VideoCodecId } from './presets'
import { VoiceGraph, VoiceProcessor, captureConstraints } from './processing'
import { playCue, setCueOutput, type Cue } from './sounds'
import { StatsDelta, audioIn, audioOut, videoIn, videoOut } from './stats'
import { initialState, patch, useMedia, type ConnectionState, type MediaState, type DeviceInfo, type ParticipantView, type Quality, type StreamQuality } from './store'
import type { GateReport } from './vad-gate.worklet'

export interface JoinParams {
  url: string
  token: string
  /** Opus target for this channel (VoiceJoinResponse.bitrateKbps). Default 64. */
  bitrateKbps?: number
  channelId?: string
  /** Fresh credentials for automatic rejoin (tokens are short-lived). */
  refresh?: () => Promise<{ url: string; token: string }>
  /** false = join listen-only (no mic capture). */
  publishMic?: boolean
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
  private screenPub: { video: LocalTrackPublication; audio: LocalTrackPublication | null; preset: ScreenPreset; fps: number[] } | null = null
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

  /** Wire OS/bridge integrations once (idempotent). Called lazily by every public entry point. */
  private start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    const p = this.prefs.get()
    this.activeInput = p.inputDeviceId
    this.activeOutput = p.outputDeviceId
    patch('self', { inputMode: p.inputMode, processing: p.processing, processingActive: p.processing, sensitivityDb: p.sensitivityDb })
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
    void this.probeEncoder()
  }

  // ───────────────────────────── voice ─────────────────────────────

  async join(params: JoinParams): Promise<void> {
    this.start()
    if (this.room) await this.leave(true)
    this.clearRejoin()
    this.last = params
    this.userLeft = false
    const t0 = performance.now()
    this.setConn('connecting', null, { channelId: params.channelId ?? null, joinMs: null })
    const kbps = params.bitrateKbps ?? DEFAULT_KBPS
    const room = new Room({
      adaptiveStream: ADAPTIVE,
      dynacast: true,
      // Remote audio through WebAudio: enables >100% per-user gain and AudioContext.setSinkId.
      webAudioMix: true,
      audioOutput: { deviceId: this.activeOutput ?? 'default' },
      publishDefaults: { dtx: true, red: true, forceStereo: false, audioPreset: { maxBitrate: kbps * 1000 }, stopMicTrackOnMute: false },
      disconnectOnPageLeave: true,
      reconnectPolicy: new DefaultReconnectPolicy(RECONNECT_DELAYS_MS),
    })
    this.room = room
    this.wire(room)
    try {
      // Video is subscribed on demand (watch()); voice is subscribed explicitly in addRemote().
      await room.connect(params.url, params.token, { autoSubscribe: false })
    } catch (e) {
      if (this.room === room) {
        this.room = null
        room.removeAllListeners()
        this.setConn('disconnected', `Não foi possível conectar ao servidor de voz: ${errText(e)}`)
      }
      throw e
    }
    if (this.room !== room) return
    void room.startAudio().catch(() => undefined)
    patch('self', { identity: room.localParticipant.identity })
    for (const rp of room.remoteParticipants.values()) this.addRemote(rp)
    if (params.publishMic !== false) await this.publishMic(room, kbps)
    if (this.room !== room) return
    this.rejoinAttempt = 0
    this.setConn('connected', null, { room: room.name, joinMs: Math.round(performance.now() - t0) })
    this.startTimers()
    this.cue('join')
    this.syncTray()
  }

  async leave(silent = false): Promise<void> {
    this.userLeft = true
    this.clearRejoin()
    const room = this.room
    if (!room) {
      this.setConn('idle', null)
      return
    }
    await this.stopScreenShare(true).catch(() => undefined)
    this.room = null
    await this.teardown()
    await room.disconnect(true).catch(() => undefined)
    room.removeAllListeners()
    if (!silent) this.cue('leave')
    this.setConn('idle', null, { room: null, channelId: null })
    this.syncTray()
  }

  private async publishMic(room: Room, kbps: number): Promise<void> {
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
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true, forceStereo: false, audioPreset: { maxBitrate: kbps * 1000 } })
      patch('self', { micAvailable: true })
      patch('devices', { inputId: this.activeInput })
      void this.refreshDevices(false)
    } catch (e) {
      this.mic?.stop()
      this.mic = null
      await graph.close()
      this.graph = null
      patch('self', { micAvailable: false })
      this.notify(`Microfone indisponível (${errText(e)}). Você está só ouvindo.`)
    }
  }

  private wire(room: Room): void {
    room
      .on(RoomEvent.ParticipantConnected, (rp) => {
        this.addRemote(rp)
        this.cue('join')
      })
      .on(RoomEvent.ParticipantDisconnected, (rp) => {
        this.viewerEls.delete(rp.identity)
        useMedia.setState((s) => {
          const viewers = { ...s.viewers }
          delete viewers[rp.identity]
          return { viewers }
        })
        this.cue('leave')
      })
      .on(RoomEvent.TrackPublished, (pub, rp) => this.onRemotePublished(pub, rp))
      .on(RoomEvent.TrackSubscribed, (track, pub, rp) => this.onSubscribed(track, pub, rp))
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) if (this.audioEls.delete(el)) el.remove()
      })
      .on(RoomEvent.TrackUnpublished, (pub, rp) => {
        if (pub.source === Track.Source.ScreenShare) this.unwatch(rp.identity)
      })
      .on(RoomEvent.SignalReconnecting, () => this.onReconnecting())
      .on(RoomEvent.Reconnecting, () => this.onReconnecting())
      .on(RoomEvent.Reconnected, () => {
        const ms = this.reconnectT0 ? Math.round(performance.now() - this.reconnectT0) : null
        this.reconnectT0 = 0
        this.setConn('connected', null, { lastReconnectMs: ms, reconnects: useMedia.getState().connection.reconnects + 1 })
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
      this.setConn('disconnected', text)
      return
    }
    this.setConn('disconnected', `${text} Tentando entrar de novo…`)
    this.scheduleRejoin()
  }

  private scheduleRejoin(): void {
    this.clearRejoin()
    const delay = REJOIN_BACKOFF_MS[this.rejoinAttempt]
    if (delay === undefined) {
      this.setConn('disconnected', 'Sem conexão com o servidor de voz. Entre no canal de novo quando a rede voltar.')
      return
    }
    this.rejoinTimer = setTimeout(() => void this.rejoin(), navigator.onLine === false ? Math.max(delay, 5000) : delay)
  }

  private async rejoin(): Promise<void> {
    const last = this.last
    if (!last || this.userLeft) return
    this.rejoinAttempt++
    try {
      const fresh = last.refresh ? await last.refresh() : null
      await this.join({ ...last, ...(fresh ?? {}) })
    } catch {
      if (!this.userLeft) this.scheduleRejoin()
    }
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
    patch('self', { speaking: false, level: 0, levelDb: init.self.levelDb, gateOpen: false })
  }

  private setConn(state: ConnectionState, reason: string | null, extra: Partial<MediaState['connection']> = {}): void {
    patch('connection', { state, reason, ...extra })
  }

  // ───────────────────────────── participants ─────────────────────────────

  private addRemote(rp: RemoteParticipant): void {
    for (const pub of rp.trackPublications.values()) this.onRemotePublished(pub, rp)
    this.applyVolume(rp.identity)
  }

  private onRemotePublished(pub: RemoteTrackPublication, rp: RemoteParticipant): void {
    if (pub.source === Track.Source.Microphone) pub.setSubscribed(true)
    else if (pub.source === Track.Source.ScreenShare) {
      this.cue('streamStart')
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
    } else if (pub.source === Track.Source.ScreenShare) {
      if (this.room) this.room.options.adaptiveStream = ADAPTIVE
      for (const el of this.viewerEls.get(rp.identity) ?? []) track.attach(el)
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
    if (!real || (real.width >= set!.width! && real.height >= set!.height!)) return stream
    stream.getTracks().forEach((t) => t.stop())
    // Multiple of 8: the /4 and /2 simulcast layers (presets.simulcastFor) stay even, as the HW encoder needs.
    return open(real.width & ~1, real.height & ~1)
  }

  async startScreenShare(opts: ScreenShareOptions = {}): Promise<void> {
    this.start()
    const room = this.room
    if (!room) throw new Error('Entre em um canal de voz antes de transmitir.')
    if (this.screenPub) await this.stopScreenShare(true)
    const p = this.prefs.get()
    const preset = getPreset(opts.quality ?? p.screenPreset)
    const contentType = opts.contentType ?? p.contentType
    const codec = opts.codec ?? useMedia.getState().screen.codec
    const audio = opts.audio ?? false
    this.prefs.set({ screenPreset: preset.id, contentType, ...(opts.codec && { codec: opts.codec }) })
    patch('screen', { preset: preset.id, contentType, codec, audio, error: null })
    let stream: MediaStream
    try {
      stream = opts.stream ?? (await this.capture(opts.sourceId, audio, preset))
    } catch (e) {
      patch('screen', { error: `Captura cancelada ou indisponível: ${errText(e)}` })
      throw e
    }
    try {
      const pub = await this.publishScreen(room, stream, preset, contentType, codec)
      this.screenPub = { ...pub, preset, fps: [] }
      patch('screen', { active: true, sourceId: opts.sourceId ?? null })
      this.cue('streamStart')
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      patch('screen', { error: `Falha ao publicar a transmissão: ${errText(e)}` })
      throw e
    }
  }

  private async publishScreen(room: Room, stream: MediaStream, preset: ScreenPreset, contentType: ContentType, codec: VideoCodecId) {
    const video = stream.getVideoTracks()[0]!
    const { hint, degradation } = contentSettings(contentType)
    video.contentHint = hint
    video.addEventListener('ended', () => void this.stopScreenShare())
    const size = video.getSettings()
    const svc = codec === 'vp9' || codec === 'av1'
    const advanced = svc || codec === 'h265'
    const vpub = await room.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      name: 'screen',
      videoCodec: codec,
      // Codecs not every viewer can decode get an H.264 backup the SFU switches to per subscriber.
      backupCodec: advanced ? { codec: 'h264', encoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.fps } } : false,
      screenShareEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: preset.fps, priority: 'high' },
      screenShareSimulcastLayers: simulcastFor(preset, size.width, size.height).map((l) => new VideoPreset(l.width, l.height, l.maxBitrate, l.fps)),
      simulcast: true,
      scalabilityMode: svc ? 'L3T3_KEY' : undefined,
      degradationPreference: degradation,
    })
    const a = stream.getAudioTracks()[0]
    const apub = a
      ? await room.localParticipant.publishTrack(a, { source: Track.Source.ScreenShareAudio, name: 'screen_audio', dtx: false, red: true, forceStereo: true, audioPreset: AudioPresets.musicHighQualityStereo })
      : null
    return { video: vpub, audio: apub }
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
    const room = this.room
    // LiveKit's unpublish only makes the transceivers inactive. Chromium keeps their send streams, and with
    // them every encoder instance (3 simulcast layers + backup codec), for the life of the connection:
    // +39 MB per share with OpenH264, +165 MB with VP9 (docs/benchmarks/media-baseline.md §4). Stopping
    // the transceivers releases them.
    const tracks = [cur.video.track, cur.audio?.track].filter((t) => !!t)
    const senders = new Set(tracks.flatMap((t) => [t.sender, ...('simulcastCodecs' in t ? [...(t as LocalVideoTrack).simulcastCodecs.values()].map((c) => c.sender) : [])]))
    const transceivers = room?.engine.pcManager?.publisher.getTransceivers().filter((t) => senders.has(t.sender)) ?? []
    for (const el of this.ownEls) cur.video.track?.detach(el)
    for (const track of tracks) {
      track.stop()
      await room?.localParticipant.unpublishTrack(track, true).catch(() => undefined)
    }
    if (room && transceivers.length) await releaseTransceivers(room, transceivers)
    if (cur.fps.length >= 10) {
      const sorted = [...cur.fps].sort((a, b) => a - b)
      const sustain = recordSustain(this.prefs.get().sustain, cur.preset.id, cur.preset.fps, sorted[Math.floor(sorted.length / 2)]!)
      this.prefs.set({ sustain })
      void this.probeEncoder()
    }
    patch('screen', { active: false, stats: null, sourceId: null })
    if (!silent) this.cue('streamStop')
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
    const chosen = this.prefs.get().codec
    const codec = chosen ?? pickCodec(hw)
    const hardware = hw[codec] ?? false
    const offered = availablePresets(
      { hardware, sourceWidth: Math.round(screen.width * devicePixelRatio), sourceHeight: Math.round(screen.height * devicePixelRatio) },
      this.prefs.get().sustain,
    )
    const cur = useMedia.getState().screen.preset
    patch('screen', { codec, codecAuto: !chosen, offered, hardwareEncoder: hardware, preset: offered.some((o) => o.id === cur) ? cur : defaultPreset(offered).id })
  }

  /** `codec: null` returns to automatic. */
  setScreenDefaults(p: { quality?: ScreenPresetId; contentType?: ContentType; codec?: VideoCodecId | null }): void {
    this.start()
    this.prefs.set({ ...(p.quality && { screenPreset: p.quality }), ...(p.contentType && { contentType: p.contentType }), ...(p.codec !== undefined && { codec: p.codec }) })
    patch('screen', { ...(p.quality && { preset: p.quality }), ...(p.contentType && { contentType: p.contentType }) })
    if (p.codec !== undefined) void this.probeEncoder()
  }

  // ───────────────────────────── screen share (viewer) ─────────────────────────────

  /** Start receiving someone's stream. Nothing is downloaded for streams nobody watches. */
  watch(identity: string, quality: StreamQuality = 'auto'): void {
    const room = this.room
    const rp = room?.remoteParticipants.get(identity)
    const vpub = rp?.getTrackPublication(Track.Source.ScreenShare)
    useMedia.setState((s) => ({ viewers: { ...s.viewers, [identity]: { identity, quality, subscribed: true, volume: this.prefs.streamVolumeOf(identity), stats: null } } }))
    if (!room || !vpub) return
    // adaptiveStream is fixed per track at subscription time; "source" subscribes this one track without it.
    if (quality === 'source') room.options.adaptiveStream = false
    vpub.setSubscribed(true)
    if (quality === 'source') vpub.setVideoQuality(VideoQuality.HIGH)
    rp?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(true)
    this.applyVolume(identity)
  }

  unwatch(identity: string): void {
    const rp = this.room?.remoteParticipants.get(identity)
    rp?.getTrackPublication(Track.Source.ScreenShare)?.setSubscribed(false)
    rp?.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(false)
    this.deltas.delete(`v:${identity}`)
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
    const pub = this.room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare)
    if (pub?.isSubscribed && this.room) {
      const room = this.room
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500)
        room.once(RoomEvent.TrackUnsubscribed, () => (clearTimeout(t), resolve()))
        pub.setSubscribed(false)
      })
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
    const track = this.room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare)?.track
    track?.attach(el)
    return () => {
      set.delete(el)
      this.room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare)?.track?.detach(el)
    }
  }

  // ───────────────────────────── stats / ui tick ─────────────────────────────

  private startTimers(): void {
    this.stopTimers()
    this.uiTimer = setInterval(() => this.tickUi(), 200)
    this.statsTimer = setInterval(() => void this.tickStats(), 1000)
  }
  private stopTimers(): void {
    if (this.uiTimer) clearInterval(this.uiTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.uiTimer = this.statsTimer = null
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
        level: Math.max(rp.audioLevel, (old?.level ?? 0) * 0.7),
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
      if (top && top.fps > 0) this.screenPub.fps.push(top.fps)
    }
    const viewers = { ...useMedia.getState().viewers }
    for (const id of Object.keys(viewers)) {
      const t = room.remoteParticipants.get(id)?.getTrackPublication(Track.Source.ScreenShare)?.track
      viewers[id] = { ...viewers[id]!, stats: t ? videoIn(this.delta(`v:${id}`).next(await t.getRTCStatsReport())) : null }
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
  }

  private cue(c: Cue): void {
    if (this.prefs.get().sounds) playCue(c)
  }

  private notify(text: string): void {
    useMedia.setState({ notice: { id: ++this.noticeId, text } })
  }

  private syncTray(): void {
    const s = useMedia.getState()
    bridge()?.tray?.setVoiceState?.({ connected: s.connection.state === 'connected', muted: s.self.muted, deafened: s.self.deafened, channelName: s.connection.room ?? undefined })
  }

  /** Dev/benchmark access (MediaLab only). Not part of the UI contract. */
  get debug() {
    return { room: this.room, graph: this.graph, mic: this.mic, screen: this.screenPub, prefs: this.prefs }
  }
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
  // shortcut: placeholders add one m-line per stopped transceiver (as many as before the fix, minus encoders); revisit if SDP size starts to show in negotiation time.
  for (const kind of kinds) pc.addTransceiverOfKind(kind, { direction: 'inactive' })
  await room.engine.negotiate().catch(() => undefined)
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
