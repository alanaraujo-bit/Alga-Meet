// The ticket stub at the end of a session (spec §7.3.10, mockup 11): what it says, formatted. Pure.
import { CINEMA_REACTIONS, type CinemaFilm, type CinemaReaction, type CinemaSummary } from '@alga/shared'
import { clock, length } from '../strings'
import { chapterAt } from './timeline'

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const pad = (n: number) => String(n).padStart(2, '0')

/** 21h04 (local time). */
export const hourMin = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getHours()}h${pad(d.getMinutes())}`
}

/** "Sexta, 6 de novembro de 2026 · 21h04" (local time). */
export function ticketDate(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()} · ${hourMin(ms)}`
}

/** "Ana, Pedro, Bia e Lucas"; past four, "Ana, Pedro, Bia e mais 3". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`
  return `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`
}

/** A stable four-digit number for the stub ("Nº 0042"), from the session id. */
export function ticketNumber(sessionId: string): string {
  let h = 0
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `Nº ${String(h % 10_000).padStart(4, '0')}`
}

export interface TicketFacts {
  together: string
  reactions: number
  admits: number
  /** The most reacted moment: film time, its chapter, how many reacted there; null without reactions. */
  peak: { position: number; at: string; chapter: string | null; count: number } | null
}

export function ticketFacts(summary: CinemaSummary, film: Pick<CinemaFilm, 'chapters'> | null): TicketFacts {
  const p = summary.peak
  return {
    together: length(summary.watchedS),
    reactions: summary.reactions,
    admits: summary.seats.length,
    peak: p && p.count > 0 ? { position: p.position, at: clock(p.position), chapter: film ? (chapterAt(film.chapters, p.position)?.chapter.title ?? null) : null, count: p.count } : null,
  }
}

/** The most sent emoji in the 10 s of film around `position` (tally: bucket -> emoji -> count), or null. */
export function peakEmoji(tally: Record<number, Partial<Record<CinemaReaction, number>>>, position: number): CinemaReaction | null {
  const b = tally[Math.floor(position / 10)]
  let best: CinemaReaction | null = null
  for (const e of CINEMA_REACTIONS) if ((b?.[e] ?? 0) > (best ? (b?.[best] ?? 0) : 0)) best = e
  return best
}
