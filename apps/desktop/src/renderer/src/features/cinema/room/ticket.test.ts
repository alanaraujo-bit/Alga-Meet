import { describe, expect, it } from 'vitest'
import { clock, t } from '../strings'
import { hourMin, nameList, peakEmoji, ticketDate, ticketFacts, ticketNumber } from './ticket'

describe('ticket', () => {
  it('dates and hours in pt-BR, local time', () => {
    expect(ticketDate(new Date(2026, 10, 6, 21, 4).getTime())).toBe('Sexta, 6 de novembro de 2026 · 21h04')
    expect(ticketDate(new Date(2027, 0, 3, 9, 0).getTime())).toBe('Domingo, 3 de janeiro de 2027 · 9h00')
    expect(hourMin(new Date(2026, 10, 6, 23, 58).getTime())).toBe('23h58')
  })

  it('names: one, two, four, more', () => {
    expect(nameList([])).toBe('')
    expect(nameList(['Ana'])).toBe('Ana')
    expect(nameList(['Ana', 'Bia'])).toBe('Ana e Bia')
    expect(nameList(['Ana', 'Pedro', 'Bia', 'Lucas'])).toBe('Ana, Pedro, Bia e Lucas')
    expect(nameList(['Ana', 'Pedro', 'Bia', 'Lucas', 'Rui', 'Eva'])).toBe('Ana, Pedro, Bia e mais 3')
  })

  it('a stable four-digit number', () => {
    const n = ticketNumber('0198b3f0-0000-7000-8000-000000000000')
    expect(n).toMatch(/^Nº \d{4}$/)
    expect(ticketNumber('0198b3f0-0000-7000-8000-000000000000')).toBe(n)
  })

  it('time together, counts, the peak with its chapter; no peak without reactions', () => {
    const film = { chapters: [{ startS: 0, title: 'Abertura' }, { startS: 4000, title: 'A travessia' }] }
    expect(ticketFacts({ watchedS: 9960, seats: ['a', 'b', 'c', 'd'], reactions: 127, peak: { position: 4360, count: 23 } }, film)).toEqual({
      together: '2h46', reactions: 127, admits: 4, peak: { position: 4360, at: '1:12:40', chapter: 'A travessia', count: 23 },
    })
    expect(ticketFacts({ watchedS: 600, seats: ['a'], reactions: 0, peak: null }, film)).toEqual({ together: '10 min', reactions: 0, admits: 1, peak: null })
    expect(ticketFacts({ watchedS: 30, seats: [], reactions: 1, peak: { position: 5, count: 1 } }, null).peak).toEqual({ position: 5, at: '0:05', chapter: null, count: 1 })
  })

  it('the emoji of the peak: the most sent in its 10 s, the first on a tie, none without any', () => {
    const tally = { 436: { '😂': 3, '🔥': 5 }, 437: { '😭': 1 }, 2: { '😱': 2, '👏': 2 } }
    expect(peakEmoji(tally, 4360)).toBe('🔥')
    expect(peakEmoji(tally, 4379)).toBe('😭')
    expect(peakEmoji(tally, 25)).toBe('😱')
    expect(peakEmoji(tally, 0)).toBeNull()
  })
})

describe('report details', () => {
  it('names the session and the moment, nothing else', () => {
    expect(t.reportDetails('Duna Parte Dois (2024)', clock(4360))).toBe('Sala de cinema: Duna Parte Dois (2024), 1:12:40')
  })
})
