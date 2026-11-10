// Music in my call: the room's state from the server (MUSIC_STATE), my own volume and whether I listen, and the
// commands. Only on a server whose READY says it plays music (an older one closes the socket on music_*).
import { youtubeId, type MusicClientFrame, type MusicState } from '@alga/shared'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { errorText } from './logic'

const PREFS_KEY = 'alga.music.v1'

interface MusicStore {
  state: MusicState | null
  /** Server clock − Date.now() (ms), from the last state. */
  offset: number
  /** One sentence under the field (a refused link), cleared by the next state. */
  error: string | null
  volume: number
  /** I can stop hearing it without stopping it for the call. */
  listening: boolean
  /** The card is open (also with nothing playing: to paste the first link). */
  open: boolean
}

const savedVolume = (): number => {
  try {
    const v = (JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { volume?: unknown }).volume
    return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0.5
  } catch {
    return 0.5
  }
}

export const useMusic = create<MusicStore>(() => ({ state: null, offset: 0, error: null, volume: savedVolume(), listening: true, open: false }))

const myChannel = (): string | null => {
  const st = useData.getState()
  return (st.me && st.voiceStates[st.me.id]?.channelId) ?? null
}
const enabled = (): boolean => useSession.getState().music
const send = (f: MusicClientFrame): boolean => useSession.getState().send(f)

export const serverTime = (): number => Date.now() + useMusic.getState().offset

/** 'sent' · 'invalid' (not a YouTube video: said here, at once) · 'no_call' · 'disabled' (an older server). */
export function addLink(raw: string): 'sent' | 'invalid' | 'no_call' | 'disabled' {
  if (!enabled()) return 'disabled'
  const channelId = myChannel()
  if (!channelId) return 'no_call'
  const url = raw.trim()
  if (!youtubeId(url)) {
    useMusic.setState({ error: errorText('invalid_link') })
    return 'invalid'
  }
  useMusic.setState({ error: null, listening: true })
  send({ op: 'music_add', channelId, url })
  return 'sent'
}

export function control(action: 'play' | 'pause' | 'skip' | 'seek' | 'stop', position?: number): void {
  const channelId = myChannel()
  if (!channelId || !enabled()) return
  send({ op: 'music_control', channelId, action, ...(position === undefined ? {} : { position }) })
}

export function remove(trackId: string): void {
  const channelId = myChannel()
  if (channelId && enabled()) send({ op: 'music_remove', channelId, trackId })
}

/** What my player saw about the song playing now. */
export function report(kind: 'ended' | 'unplayable' | 'duration', durationS?: number): void {
  const channelId = myChannel()
  const trackId = useMusic.getState().state?.now?.id
  if (!channelId || !trackId || !enabled()) return
  send({ op: 'music_report', channelId, trackId, kind, ...(durationS === undefined ? {} : { durationS }) })
}

export function setVolume(v: number): void {
  const volume = Math.min(1, Math.max(0, v))
  useMusic.setState({ volume })
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ volume }))
  } catch {}
}

export const setListening = (listening: boolean): void => useMusic.setState({ listening })
export const openCard = (): void => useMusic.setState({ open: true })
export const closeCard = (): void => useMusic.setState({ open: false })

function hello(): void {
  const channelId = myChannel()
  if (channelId && enabled()) send({ op: 'music_hello', channelId })
}

/** Wired once per signed-in shell. Returns the cleanup. */
export function startMusic(): () => void {
  let channel = myChannel()
  if (channel) hello()
  const offs = [
    onDispatch((d) => {
      if (d.t === 'READY') return d.d.music === true ? hello() : undefined
      if (d.t === 'MUSIC_STATE') {
        if (d.d.channelId !== myChannel()) return
        return useMusic.setState({ state: d.d, offset: d.d.serverNow - Date.now(), error: null })
      }
      if (d.t === 'MUSIC_ERROR') useMusic.setState({ error: errorText(d.d.reason) })
    }),
    // The server's own record of my call (not the media connection): it only takes music_* from who it sees there.
    useData.subscribe(() => {
      const c = myChannel()
      if (c === channel) return
      channel = c
      useMusic.setState({ state: null, error: null, open: false, listening: true })
      if (c) hello()
    }),
  ]
  return () => {
    for (const off of offs) off()
    useMusic.setState({ state: null, error: null, open: false, listening: true })
  }
}
