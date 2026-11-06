// The row of seats (foyer, strip, intermission): order, slots and labels. Pure.
import { CINEMA_MAX_SEATS, CINEMA_SEEK_READY_S, type CinemaSeat } from '@alga/shared'
import { t } from '../strings'

/** Me first, then who projects, then the server's order (arrival); at most CINEMA_MAX_SEATS. */
export function orderSeats(seats: CinemaSeat[], meId: string | undefined, hostId: string): CinemaSeat[] {
  const rank = (x: CinemaSeat) => (x.userId === meId ? 0 : x.userId === hostId ? 1 : 2)
  return seats
    .map((x, i) => [x, i] as const)
    .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
    .map(([x]) => x)
    .slice(0, CINEMA_MAX_SEATS)
}

/** The preparing ring: seconds held ahead over what `ready` needs (full when ready). */
export const prepFrac = (x: Pick<CinemaSeat, 'status' | 'aheadS'>): number =>
  x.status === 'ready' ? 1 : Math.min(1, Math.max(0, x.aheadS / CINEMA_SEEK_READY_S))

export type Slot = { kind: 'seat'; seat: CinemaSeat } | { kind: 'eco' } | { kind: 'free' }

/**
 * Foyer slots (mockups 03/04): the seated, the Eco keeping the places while I am alone (or hopping for a moment after
 * someone sits), then free seats up to 4 (one free at least while there is room), never more than 8 places.
 */
export function foyerSlots(seats: CinemaSeat[], eco: boolean): Slot[] {
  const out: Slot[] = seats.slice(0, CINEMA_MAX_SEATS).map((seat) => ({ kind: 'seat', seat }))
  if (eco && out.length < CINEMA_MAX_SEATS) out.push({ kind: 'eco' })
  const want = Math.min(CINEMA_MAX_SEATS, Math.max(4, out.length + 1))
  while (out.length < want) out.push({ kind: 'free' })
  return out
}

/** "2 de 3 prontos": a seat that cannot play is not waited for (the server starts without it). */
export function readiness(seats: CinemaSeat[]): { ready: number; all: number; firstPreparing: CinemaSeat | null } {
  const counted = seats.filter((x) => x.status !== 'unsupported')
  return { ready: counted.filter((x) => x.status === 'ready').length, all: counted.length, firstPreparing: counted.find((x) => x.status !== 'ready') ?? null }
}

/** The first word of a display name (the row is narrow); the full name stays in the aria-label. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/** Status under a seat: "Pronto", "Preparando · 64%", "Travou", "Não toca aqui". */
export function seatStatus(x: Pick<CinemaSeat, 'status' | 'aheadS'>): { text: string; ok: boolean } {
  if (x.status === 'ready') return { text: t.seats.ready, ok: true }
  if (x.status === 'unsupported') return { text: t.seats.unsupported, ok: false }
  if (x.status === 'stalled') return { text: t.seats.stalled, ok: false }
  return { text: t.seats.preparing(Math.round(prepFrac(x) * 100)), ok: false }
}
