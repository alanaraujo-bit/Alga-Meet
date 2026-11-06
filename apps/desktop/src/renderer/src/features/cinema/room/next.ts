// The next episode at the end of the credits (spec §7.3.10, mockup 10), as the host's client drives it. Pure.
import type { CinemaFilm } from '@alga/shared'
import type { RoomScreen } from './view'

/** The film is over when the room is this close to its end (positionAt clamps at the duration). */
export const END_EPSILON_S = 0.5

export type NextStep = 'prepare' | 'switch' | 'end' | null

/**
 * What the host does now. In the credits with a next file: prepare it (probe in the background, then announce it to
 * the room); when the 10 s run out with it announced: switch. At the very end with nothing to switch to: end the
 * session, so everyone gets the ticket.
 */
export function nextStep(i: {
  screen: RoomScreen
  nextUpS: number | null
  position: number
  durationS: number
  playing: boolean
  /** The folder has a next file. */
  hasNext: boolean
  /** Probe running / done, or the host cancelled for this film. */
  preparing: boolean
  prepared: boolean
  cancelled: boolean
  /** The room shows the announcement (session.next). */
  announced: boolean
}): NextStep {
  const ready = i.prepared && i.announced && !i.cancelled
  const atEnd = i.position >= i.durationS - END_EPSILON_S
  if (i.screen === 'credits' && i.hasNext && !i.cancelled && !i.prepared && !i.preparing) return 'prepare'
  // credits shorter than 10 s: the end of the film is the switch too
  if (i.screen === 'credits' && ready && (i.nextUpS === 0 || atEnd)) return 'switch'
  if (i.playing && !ready && atEnd) return 'end'
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "S01E03", or null for a film. */
export const episodeCode = (film: Pick<CinemaFilm, 'episode'>): string | null =>
  film.episode ? `S${pad(film.episode.season)}E${pad(film.episode.episode)}` : null

/** "S01E03 — A Travessia" (a file name carries no episode title), or the title alone for a film. */
export const episodeLabel = (film: Pick<CinemaFilm, 'title' | 'episode'>): string => {
  const code = episodeCode(film)
  return code ? `${code} — ${film.title}` : film.title
}
