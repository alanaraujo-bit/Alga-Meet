// Observable media state for the UI (zustand). Only the engine writes to it.
import { create } from 'zustand'
import type { E2eeMember } from '../../../shared/bridge'
import { DEFAULT_PREFS, type InputMode, type ProcessingMode } from './prefs'
import type { ContentType, ScreenPreset, ScreenPresetId, VideoCodecId } from './presets'
import type { AudioInStats, AudioOutStats, VideoInStats, VideoOutStats } from './stats'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export type Quality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
export type StreamQuality = 'auto' | 'source'

export interface DeviceInfo {
  deviceId: string
  label: string
}

export interface ParticipantView {
  identity: string
  name: string
  speaking: boolean
  /**
   * Perceptual speaking level 0..1, ready for meters/glow (no conversion needed): RMS of the received voice
   * over the last ~43 ms in dBFS, mapped linearly −50 dBFS → 0 … −20 dBFS → 1 (`perceptualLevel`), instant
   * attack and ~150 ms release, refreshed every 50 ms. Measured on this machine's decoded audio, not the SFU's.
   */
  level: number
  micMuted: boolean
  /** Playback volume 0..2 (persisted per userId). */
  volume: number
  locallyMuted: boolean
  streaming: boolean
  streamHasAudio: boolean
  quality: Quality
  audio: AudioInStats | null
}

export interface ViewerView {
  identity: string
  quality: StreamQuality
  subscribed: boolean
  volume: number
  stats: VideoInStats | null
}

export interface MediaState {
  connection: {
    state: ConnectionState
    /** Human-readable (pt-BR) reason for the current state, e.g. why we disconnected. */
    reason: string | null
    channelId: string | null
    room: string | null
    /** ms from join() to connected + mic published. */
    joinMs: number | null
    /** ms of the last reconnection (Reconnecting -> Reconnected). */
    lastReconnectMs: number | null
    reconnects: number
    /** true while an automatic recovery is pending (LiveKit reconnecting or a scheduled rejoin); false once it gave up or the end is terminal. */
    willRetry: boolean
    /** Human channel name for the tray/titles (media.setContext); null = unknown. */
    channelName: string | null
  }
  self: {
    identity: string | null
    muted: boolean
    deafened: boolean
    speaking: boolean
    /** Smoothed 0..1 for meters. */
    level: number
    levelDb: number
    thresholdDb: number
    gateOpen: boolean
    inputMode: InputMode
    pttPressed: boolean
    processing: ProcessingMode
    /** What actually runs (advanced falls back to standard if RNNoise can't load). */
    processingActive: ProcessingMode
    sensitivityDb: number | null
    micAvailable: boolean
    /** The server (moderator) took away microphone publishing. Independent of `muted` (the user's own choice). */
    serverMuted: boolean
    /** Own connection quality as rated by the SFU. */
    quality: Quality
    /** UI cues on/off (pref). */
    sounds: boolean
    /** PTT release delay in ms (pref). */
    pttReleaseMs: number
  }
  participants: Record<string, ParticipantView>
  devices: { inputs: DeviceInfo[]; outputs: DeviceInfo[]; inputId: string | null; outputId: string | null }
  notice: { id: number; text: string } | null
  local: AudioOutStats | null
  screen: {
    active: boolean
    preset: ScreenPresetId
    contentType: ContentType
    /** Effective codec (the user's choice or the automatic pick). */
    codec: VideoCodecId
    codecAuto: boolean
    audio: boolean
    sourceId: string | null
    /** What you can pick: sustained by this machine AND allowed by your plan. */
    offered: ScreenPreset[]
    /** Sustained by this machine but not in your plan (show with the plan hint; never a preset the hardware can't do). */
    locked: ScreenPreset[]
    /** Presets your plan allows (STREAM_PRESETS ids); null = not known yet (the server still enforces). */
    plan: ScreenPresetId[] | null
    hardwareEncoder: boolean | null
    stats: VideoOutStats | null
    error: string | null
  }
  viewers: Record<string, ViewerView>
  micTest: { active: boolean; loopback: boolean }
  /** End-to-end encryption of the call (media/README.md §E2EE, decision 0004). */
  e2ee: {
    /**
     * off: not end-to-end encrypted (E2EE disabled in this build, or not signed in). establishing: joining the call's
     * MLS group; nothing is published yet. active: everything we send and play is encrypted with the call's keys.
     * failed: E2EE could not be set up or was lost; the call was left (connection.reason says why), never downgraded.
     */
    state: 'off' | 'establishing' | 'active' | 'failed'
    /** MLS epoch we send with (changes on every join/leave); null when not active. */
    epoch: number | null
    /** The MLS group (who holds the keys), self included. Compare with `participants`, never a server list. */
    members: E2eeMember[]
    /**
     * Identities we cannot vouch for, after 2 s: in the SFU room without an MLS leaf, an MLS leaf not in the room
     * (ghost), two leaves for one user, or publishing unencrypted (never played). Non-empty = show the warning.
     */
    mismatch: string[]
  }
}

export const initialState = (): MediaState => ({
  connection: { state: 'idle', reason: null, channelId: null, room: null, joinMs: null, lastReconnectMs: null, reconnects: 0, willRetry: false, channelName: null },
  self: {
    identity: null,
    muted: false,
    deafened: false,
    speaking: false,
    level: 0,
    levelDb: -120,
    thresholdDb: -50,
    gateOpen: false,
    inputMode: DEFAULT_PREFS.inputMode,
    pttPressed: false,
    processing: DEFAULT_PREFS.processing,
    processingActive: DEFAULT_PREFS.processing,
    sensitivityDb: null,
    micAvailable: true,
    serverMuted: false,
    quality: 'unknown',
    sounds: DEFAULT_PREFS.sounds,
    pttReleaseMs: DEFAULT_PREFS.pttReleaseMs,
  },
  participants: {},
  devices: { inputs: [], outputs: [], inputId: null, outputId: null },
  notice: null,
  local: null,
  screen: {
    active: false,
    preset: DEFAULT_PREFS.screenPreset,
    contentType: DEFAULT_PREFS.contentType,
    codec: 'h264',
    codecAuto: true,
    audio: false,
    sourceId: null,
    offered: [],
    locked: [],
    plan: null,
    hardwareEncoder: null,
    stats: null,
    error: null,
  },
  viewers: {},
  micTest: { active: false, loopback: false },
  e2ee: { state: 'off', epoch: null, members: [], mismatch: [] },
})

export const useMedia = create<MediaState>(() => initialState())

/** Shallow-merge helper for nested slices. */
export function patch<K extends keyof MediaState>(key: K, value: Partial<MediaState[K]>): void {
  useMedia.setState((s) => ({ [key]: { ...(s[key] as object), ...(value as object) } }) as Pick<MediaState, K>)
}
