// What the user does in the cinema: project a file (pick/drop → ffmpeg check → probe → sheet → open), sit, control the
// room, react, choose their own audio/subtitle, end. Frames go through the gateway; the engine lives in store.ts.
import type { CinemaReaction } from '@alga/shared'
import {
  callChannel, chooseAudio, chooseSubtitle, hostBegin, hostEnd, ipNoticeOnce, send, setPrefs, useCinema,
} from './store'
import { t } from './strings'

type Picked = { fileId: string; name: string }

/** The ffmpeg check comes first (spec §6.3: an antivirus block must say so, never fail mute), then the probe. */
async function prepare(pick: () => Promise<Picked | null>): Promise<void> {
  const c = window.alga.cinema
  useCinema.setState({ error: null })
  let f: Picked | null = null
  try {
    f = await pick()
    if (!f) return
    useCinema.setState({ busy: true })
    const ff = await c.checkFfmpeg()
    if (!ff.ok) {
      console.warn('[cinema] ffmpeg', ff.reason)
      useCinema.setState({ error: ff.reason === 'blocked' ? t.ffmpegBlocked : ff.reason === 'missing' ? t.ffmpegMissing : t.ffmpegCrashed })
      return void c.close(f.fileId).catch(() => undefined)
    }
    const r = await c.probe(f.fileId)
    if ('error' in r) {
      useCinema.setState({ error: t.probeErrors[r.error] ?? t.probeErrors.unreadable })
      return void c.close(f.fileId).catch(() => undefined)
    }
    // r.next: the later episodes of the folder (the room switches to the first at the end of the credits)
    const decodes = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(r.film.videoMime)
    useCinema.setState({ draft: { fileId: f.fileId, name: f.name, film: r.film, warnings: r.warnings, decodes, next: r.next } })
  } catch (e) {
    console.warn('[cinema] open file', e)
    useCinema.setState({ error: t.probeErrors.unreadable })
    if (f) void c.close(f.fileId).catch(() => undefined)
  } finally {
    useCinema.setState({ busy: false })
  }
}

/** Cinema button: native file dialog in main. */
export const openFromFile = (): Promise<void> => prepare(() => window.alga.cinema.pick())

/** A video dropped on the stage (the preload resolves its path; only the fileId comes back). */
export const openFromDrop = (file: File): Promise<void> => prepare(() => window.alga.cinema.fromDrop(file))

/** "Abrir sessão" on the sheet: the film goes to the server under the (edited) title; the factory starts with the session at `startS` ("Continuar de …"). */
export function openSession(title: string, startS = 0): void {
  const d = useCinema.getState().draft
  const channelId = callChannel()
  if (!d || !channelId) return
  const film = { ...d.film, title: title.trim().slice(0, 120) || d.film.title }
  hostBegin(d.fileId, film, d.next)
  ipNoticeOnce() // the host sits on open
  useCinema.setState({ draft: null, busy: true, error: null })
  if (!send({ op: 'cinema_open', channelId, film, startS: Math.min(Math.max(0, startS), film.durationS) })) {
    hostEnd()
    useCinema.setState({ busy: false })
  }
}

export function cancelDraft(): void {
  const d = useCinema.getState().draft
  if (d) void window.alga.cinema.close(d.fileId).catch(() => undefined)
  useCinema.setState({ draft: null })
}

export function seat(seated: boolean): void {
  const s = useCinema.getState().session
  if (!s) return
  if (seated) ipNoticeOnce()
  useCinema.getState().audio?.resume()
  send({ op: 'cinema_seat', sessionId: s.sessionId, seated })
}

/** Play/pause/seek/start for the whole room; `seq` = the last timeline I saw (an older one is refused as stale). */
export function control(action: 'start' | 'play' | 'pause' | 'seek', position?: number): void {
  const s = useCinema.getState().session
  if (!s) return
  useCinema.getState().audio?.resume() // a user gesture: the film audio may start now
  const pos = position === undefined ? undefined : Math.min(Math.max(0, position), s.film.durationS)
  send({ op: 'cinema_control', sessionId: s.sessionId, action, seq: s.playback.seq, ...(pos === undefined ? {} : { position: pos }) })
}

export function continueWithout(userId: string): void {
  const s = useCinema.getState().session
  if (s) send({ op: 'cinema_control', sessionId: s.sessionId, action: 'continue_without', target: userId, seq: s.playback.seq })
}

export function react(emoji: CinemaReaction): void {
  const s = useCinema.getState().session
  if (s) send({ op: 'cinema_react', sessionId: s.sessionId, emoji })
}

/** My own audio track (only for me). */
export const setAudio = (id: number): void => chooseAudio(id)

/** My own subtitle (null = off). */
export const setSubtitle = (id: number | null): void => chooseSubtitle(id)

export function setSubtitleOffset(offsetS: number): void {
  useCinema.setState((s) => ({ mine: { ...s.mine, offsetS: Math.round(Math.min(10, Math.max(-10, offsetS)) * 10) / 10 } }))
}

export function end(): void {
  const s = useCinema.getState().session
  if (s) send({ op: 'cinema_end', sessionId: s.sessionId })
}

/** Film volume, my mute and ducking (kept for next time). */
export { setPrefs }

export const dismissNotice = (text: string): void => useCinema.setState((s) => ({ notices: s.notices.filter((x) => x !== text) }))
export const dismissError = (): void => useCinema.setState({ error: null })
export const setStatsOpen = (statsOpen: boolean): void => useCinema.setState({ statsOpen })
