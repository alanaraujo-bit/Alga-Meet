import type { CinemaSeat } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { firstName, foyerSlots, orderSeats, prepFrac, readiness, seatStatus } from './seats'

const seat = (userId: string, status: CinemaSeat['status'] = 'ready', aheadS = 0): CinemaSeat => ({ userId, status, aheadS, direct: true })

describe('orderSeats', () => {
  it('me first, then the host, then arrival order', () => {
    const xs = [seat('ana'), seat('pedro'), seat('me'), seat('bia')]
    expect(orderSeats(xs, 'me', 'bia').map((x) => x.userId)).toEqual(['me', 'bia', 'ana', 'pedro'])
    expect(orderSeats(xs, 'ana', 'ana').map((x) => x.userId)).toEqual(['ana', 'pedro', 'me', 'bia'])
    expect(orderSeats(xs, undefined, 'zz').map((x) => x.userId)).toEqual(['ana', 'pedro', 'me', 'bia'])
  })

  it('at most 8 seats, me kept even when I arrived last', () => {
    const xs = Array.from({ length: 9 }, (_, i) => seat(`u${i}`))
    const out = orderSeats(xs, 'u8', 'u0')
    expect(out).toHaveLength(8)
    expect(out.map((x) => x.userId)).toEqual(['u8', 'u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  })
})

describe('foyerSlots', () => {
  const kinds = (xs: ReturnType<typeof foyerSlots>) => xs.map((x) => (x.kind === 'seat' ? x.seat.userId : x.kind))
  it('alone: me, the Eco, two free (mockup 04)', () => {
    expect(kinds(foyerSlots([seat('ana')], true))).toEqual(['ana', 'eco', 'free', 'free'])
  })
  it('three seated: one free (mockup 03)', () => {
    expect(kinds(foyerSlots([seat('ana'), seat('pedro'), seat('bia')], false))).toEqual(['ana', 'pedro', 'bia', 'free'])
  })
  it('a full room of 8 has no free seat and no Eco', () => {
    const xs = Array.from({ length: 8 }, (_, i) => seat(`u${i}`))
    expect(kinds(foyerSlots(xs, true))).toEqual(xs.map((x) => x.userId))
    expect(foyerSlots(Array.from({ length: 6 }, (_, i) => seat(`u${i}`)), false)).toHaveLength(7)
  })
})

describe('labels', () => {
  it('readiness skips seats that cannot play', () => {
    expect(readiness([seat('a'), seat('b', 'preparing', 1), seat('c', 'unsupported')])).toEqual({ ready: 1, all: 2, firstPreparing: seat('b', 'preparing', 1) })
    expect(readiness([]).firstPreparing).toBeNull()
  })

  it('preparing ring and status', () => {
    expect(prepFrac(seat('a', 'preparing', 1.92))).toBeCloseTo(0.64)
    expect(prepFrac(seat('a', 'preparing', 99))).toBe(1)
    expect(prepFrac(seat('a', 'ready', 0))).toBe(1)
    expect(seatStatus(seat('a', 'preparing', 1.92))).toEqual({ text: 'Preparando · 64%', ok: false })
    expect(seatStatus(seat('a'))).toEqual({ text: 'Pronto', ok: true })
    expect(seatStatus(seat('a', 'unsupported')).ok).toBe(false)
  })

  it('first names: long names stay whole (the row ellipsizes them), RTL names keep their first word', () => {
    expect(firstName('Ana Souza')).toBe('Ana')
    const long = 'Bartholomeu'.padEnd(32, 'x')
    expect(firstName(long)).toBe(long)
    expect(firstName('  محمد علي ')).toBe('محمد')
    expect(firstName('   ')).toBe('   ')
  })
})
