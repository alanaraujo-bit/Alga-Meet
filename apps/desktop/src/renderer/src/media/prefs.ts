// Persisted media preferences (per profile, since each profile has its own userData/localStorage).
import type { SustainRecord, ScreenPresetId, ContentType, VideoCodecId } from './presets'

export type ProcessingMode = 'standard' | 'advanced' | 'off'
export type InputMode = 'vad' | 'ptt'

export interface MediaPrefs {
  inputDeviceId: string | null
  outputDeviceId: string | null
  processing: ProcessingMode
  inputMode: InputMode
  /** Manual VAD threshold (dBFS); null = automatic. */
  sensitivityDb: number | null
  pttReleaseMs: number
  /** Per userId playback volume, 0..2 (1 = 100%). */
  volumes: Record<string, number>
  /** Per userId stream (screen share audio) volume, 0..2. */
  streamVolumes: Record<string, number>
  screenPreset: ScreenPresetId
  contentType: ContentType
  /** null = automatic (pickCodec over the hardware probe). */
  codec: VideoCodecId | null
  sustain: SustainRecord
  sounds: boolean
}

export const DEFAULT_PREFS: MediaPrefs = {
  inputDeviceId: null,
  outputDeviceId: null,
  processing: 'standard',
  inputMode: 'vad',
  sensitivityDb: null,
  pttReleaseMs: 150,
  volumes: {},
  streamVolumes: {},
  screenPreset: '1080p60',
  contentType: 'motion',
  codec: null,
  sustain: {},
  sounds: true,
}

const KEY = 'alga.media.prefs.v1'

export const clampVolume = (v: number): number => (Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1)

export class PrefsStore {
  private value: MediaPrefs
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
    this.value = load(storage)
  }
  get(): MediaPrefs {
    return this.value
  }
  set(patch: Partial<MediaPrefs>): MediaPrefs {
    this.value = { ...this.value, ...patch }
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.value))
    } catch {
      // quota/private mode: preferences just don't persist
    }
    return this.value
  }
  volumeOf(userId: string): number {
    return this.value.volumes[userId] ?? 1
  }
  setVolume(userId: string, v: number): number {
    const vol = clampVolume(v)
    const volumes = { ...this.value.volumes }
    // 100% is the default: don't store it, so the map only holds real overrides.
    if (vol === 1) delete volumes[userId]
    else volumes[userId] = vol
    this.set({ volumes })
    return vol
  }
  streamVolumeOf(userId: string): number {
    return this.value.streamVolumes[userId] ?? 1
  }
  setStreamVolume(userId: string, v: number): number {
    const vol = clampVolume(v)
    this.set({ streamVolumes: { ...this.value.streamVolumes, [userId]: vol } })
    return vol
  }
}

function load(storage: Pick<Storage, 'getItem'> | null): MediaPrefs {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<MediaPrefs>
    const merged = { ...DEFAULT_PREFS, ...parsed }
    // Drop corrupt entries rather than feeding NaN into a GainNode.
    merged.volumes = Object.fromEntries(Object.entries(merged.volumes ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [k, clampVolume(v)]))
    merged.streamVolumes = Object.fromEntries(Object.entries(merged.streamVolumes ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]) => [k, clampVolume(v)]))
    return merged
  } catch {
    return { ...DEFAULT_PREFS }
  }
}
