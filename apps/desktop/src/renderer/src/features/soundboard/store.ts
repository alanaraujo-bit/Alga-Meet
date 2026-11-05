// Soundboard state: sounds per space, who is playing what, your cooldown, and the listener's volume/mute.
import { ALGA_SOUNDS, algaSound, type Dispatch, type SpaceSound } from '@alga/shared'
import { create } from 'zustand'
import { ApiRequestError, api, upload } from '@/lib/api'
import { useMedia } from '@/media/store'
import { useData } from '@/store/data'
import { onDispatch } from '@/store/session'
import { cooldownAfterPlay, lateDrop, shouldHear } from './logic'
import * as player from './player'
import { t } from './strings'

export interface Playing { soundId: string; emoji: string | null; name: string; from: number; until: number; playId: string }

export interface SoundboardState {
  bySpace: Record<string, SpaceSound[]>
  /** userId → the sound they are playing now (in your call). */
  playing: Record<string, Playing>
  /** Your own last play (drives the tile's progress bar). */
  mine: { soundId: string; from: number; until: number } | null
  cooldownFrom: number
  cooldownUntil: number
  volume: number
  muted: boolean
  open: boolean
  /** Upload editor (new sound) or rename (`sound` set); null = closed. */
  editor: { spaceId: string; sound?: SpaceSound } | null
}

const PREFS_KEY = 'alga.soundboard.v1'
function loadPrefs(): { volume: number; muted: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { volume?: unknown; muted?: unknown }
    const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 0.7
    return { volume, muted: p.muted === true }
  } catch {
    return { volume: 0.7, muted: false }
  }
}

export const useSoundboard = create<SoundboardState>(() => ({
  bySpace: {}, playing: {}, mine: null, cooldownFrom: 0, cooldownUntil: 0, ...loadPrefs(), open: false, editor: null,
}))

function savePrefs(): void {
  const { volume, muted } = useSoundboard.getState()
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ volume, muted })) } catch { /* private mode */ }
}

export function setVolume(volume: number): void {
  useSoundboard.setState({ volume: Math.min(1, Math.max(0, volume)) })
  savePrefs()
}

export function setMuted(muted: boolean): void {
  useSoundboard.setState({ muted })
  if (muted) player.stopAll()
  savePrefs()
}

export const setOpen = (open: boolean): void => useSoundboard.setState({ open })
export const openEditor = (editor: SoundboardState['editor']): void => useSoundboard.setState({ editor, ...(editor ? { open: false } : {}) })

/** Sound metadata for an id in a space (space sound or Alga pack). */
export function soundInfo(spaceId: string | null, id: string): { name: string; emoji: string | null; durationMs: number } | undefined {
  return algaSound(id) ?? (spaceId ? useSoundboard.getState().bySpace[spaceId]?.find((s) => s.id === id) : undefined)
}

function setSounds(spaceId: string, sounds: SpaceSound[]): void {
  const before = useSoundboard.getState().bySpace[spaceId] ?? []
  for (const s of before) if (!sounds.some((n) => n.id === s.id)) player.evict(s.id)
  useSoundboard.setState((st) => ({ bySpace: { ...st.bySpace, [spaceId]: sounds } }))
  if (callSpace() === spaceId) void player.preload(spaceId, sounds.map((s) => s.id))
}

export async function loadSounds(spaceId: string): Promise<void> {
  setSounds(spaceId, await api<SpaceSound[]>('GET', `/spaces/${spaceId}/sounds`))
}

export async function uploadSound(spaceId: string, wav: Uint8Array, meta: { name: string; emoji: string | null }, onProgress?: (p: number) => void): Promise<SpaceSound> {
  const fd = new FormData()
  fd.append('payload_json', JSON.stringify(meta))
  fd.append('file', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'som.wav')
  return upload<SpaceSound>('POST', `/spaces/${spaceId}/sounds`, fd, onProgress)
}

export const renameSound = (spaceId: string, id: string, meta: { name: string; emoji: string | null }) =>
  api<SpaceSound>('PATCH', `/spaces/${spaceId}/sounds/${id}`, meta)

export const deleteSound = (spaceId: string, id: string) => api<void>('DELETE', `/spaces/${spaceId}/sounds/${id}`)

export type PlayResult = { ok: true } | { ok: false; message: string }

/** Asks the server to play `soundId` for everyone in the call; the sound itself arrives as SOUNDBOARD_PLAY. */
export async function playSound(channelId: string, soundId: string): Promise<PlayResult> {
  const now = Date.now()
  if (now < useSoundboard.getState().cooldownUntil) return { ok: false, message: t.cooldown }
  try {
    await api<void>('POST', `/channels/${channelId}/soundboard/play`, { soundId })
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiRequestError && e.retry) {
      const at = Date.now()
      useSoundboard.setState((st) => ({ cooldownFrom: at, cooldownUntil: Math.max(st.cooldownUntil, at + e.retry!.afterMs) }))
    }
    return { ok: false, message: e instanceof Error ? e.message : t.failed }
  }
}

/** Preview for yourself only (ignores the soundboard mute, follows the volume). */
export async function preview(spaceId: string, soundId: string): Promise<void> {
  if (!player.playLocal(soundId, useSoundboard.getState().volume || 0.7)) {
    if (await player.load(spaceId, soundId)) player.playLocal(soundId, useSoundboard.getState().volume || 0.7)
  }
}

const callChannel = (): string | null => {
  const m = useMedia.getState().connection
  return m.state === 'idle' || m.state === 'disconnected' ? null : m.channelId
}
const callSpace = (): string | null => {
  const id = callChannel()
  return id ? useData.getState().channels[id]?.spaceId ?? null : null
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function onPlay(d: Extract<Dispatch, { t: 'SOUNDBOARD_PLAY' }>['d']): void {
  if (d.channelId !== callChannel()) return
  const spaceId = useData.getState().channels[d.channelId]?.spaceId ?? null
  const info = soundInfo(spaceId, d.soundId)
  const now = Date.now()
  const entry: Playing = { soundId: d.soundId, emoji: info?.emoji ?? null, name: info?.name ?? t.someSound, from: now, until: now + d.durationMs, playId: d.playId }
  const me = useData.getState().me?.id
  useSoundboard.setState((st) => ({
    playing: { ...st.playing, [d.userId]: entry },
    ...(d.userId === me ? { mine: { soundId: d.soundId, from: now, until: entry.until }, cooldownFrom: now, cooldownUntil: cooldownAfterPlay(now, d.durationMs) } : {}),
  }))
  clearTimeout(timers.get(d.userId))
  timers.set(d.userId, setTimeout(() => {
    timers.delete(d.userId)
    useSoundboard.setState((st) => {
      if (st.playing[d.userId]?.playId !== d.playId) return st
      const { [d.userId]: _, ...rest } = st.playing
      return { playing: rest }
    })
  }, d.durationMs + 250))

  const st = useSoundboard.getState()
  const serverDeaf = me ? useData.getState().voiceStates[me]?.serverDeaf === true : false
  if (!shouldHear({ deafened: useMedia.getState().self.deafened, serverDeaf, muted: st.muted })) return
  if (player.playLocal(d.soundId, st.volume)) return
  if (!spaceId) return
  void player.load(spaceId, d.soundId).then((buf) => {
    if (buf && !lateDrop(now, Date.now()) && d.channelId === callChannel()) player.playLocal(d.soundId, useSoundboard.getState().volume)
  })
}

export function handleSoundboardDispatch(d: Dispatch): void {
  if (d.t === 'SPACE_SOUNDS_UPDATE') setSounds(d.d.spaceId, d.d.sounds)
  else if (d.t === 'SOUNDBOARD_PLAY') onPlay(d.d)
}

/** Wired once per signed-in shell (voice.ts startVoiceSync). Returns the cleanup. */
export function startSoundboard(): () => void {
  player.setSoundboardOutput(useMedia.getState().devices.outputId)
  const offs = [
    onDispatch(handleSoundboardDispatch),
    useMedia.subscribe((s, prev) => {
      if (s.devices.outputId !== prev.devices.outputId) player.setSoundboardOutput(s.devices.outputId)
      if (s.connection.channelId !== prev.connection.channelId || s.connection.state !== prev.connection.state) {
        const spaceId = callSpace()
        if (!spaceId) {
          player.stopAll()
          useSoundboard.setState({ playing: {}, open: false })
          return
        }
        if (s.connection.state === 'connected' && prev.connection.state !== 'connected') {
          void loadSounds(spaceId).catch(() => undefined)
          void player.preload(spaceId, ALGA_SOUNDS.map((a) => a.id))
        }
      }
    }),
  ]
  return () => {
    for (const off of offs) off()
    for (const tm of timers.values()) clearTimeout(tm)
    timers.clear()
  }
}
