// The show on the film sheet (SeriesPanel): seasons, where the group stopped. Pure.
import type { CinemaEpisode } from '../../../../../shared/bridge'

export const seasonsOf = (eps: CinemaEpisode[]): number[] => [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b)

/** "Continuar a série": the first unwatched episode after the last watched one, unless it is the one already chosen. */
export function continueFrom(eps: CinemaEpisode[], selectedId: string): CinemaEpisode | null {
  const last = eps.findLastIndex((e) => e.watched)
  if (last < 0) return null
  const next = eps.slice(last + 1).find((e) => !e.watched)
  return next && next.fileId !== selectedId ? next : null
}
