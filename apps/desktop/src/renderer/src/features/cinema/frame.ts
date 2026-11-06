import { CINEMA_MAX_FRAME_BYTES, type CinemaClientFrame } from '@alga/shared'

type FilmFrame = Extract<CinemaClientFrame, { op: 'cinema_open' | 'cinema_switch' }>
const size = (f: unknown): number => JSON.stringify(f).length

/**
 * The server closes the socket on a frame over CINEMA_MAX_FRAME_BYTES. A film with a huge chapter list or long track
 * titles is trimmed until it fits: chapter titles first, then chapters (from the end), then audio/subtitle titles.
 */
export function fitFilmFrame<F extends FilmFrame>(f: F): F {
  const limit = CINEMA_MAX_FRAME_BYTES - 64 // margin for the gateway envelope
  if (size(f) <= limit) return f
  const film = { ...f.film, chapters: f.film.chapters.map((c) => ({ ...c, title: c.title.slice(0, 24) })) }
  const out = { ...f, film }
  if (size(out) <= limit) return out
  film.chapters = film.chapters.map((c) => ({ ...c, title: '' }))
  while (film.chapters.length && size(out) > limit) film.chapters.pop()
  if (size(out) <= limit) return out
  film.audio = film.audio.map((a) => ({ ...a, title: null }))
  film.subtitles = film.subtitles.map((x) => ({ ...x, title: null }))
  return out
}
