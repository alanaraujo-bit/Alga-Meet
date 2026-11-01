import { describe, expect, it } from 'vitest'
import { birthInWords, maskBirth, parseBirth } from './birthDate'

describe('birth date field', () => {
  it('masks typing into DD/MM/AAAA', () => {
    expect(maskBirth('')).toBe('')
    expect(maskBirth('2')).toBe('2')
    expect(maskBirth('2304')).toBe('23/04')
    expect(maskBirth('23042005')).toBe('23/04/2005')
    expect(maskBirth('23/04/2005 99')).toBe('23/04/2005')
    expect(maskBirth('ab23-04.2005')).toBe('23/04/2005')
  })

  it('accepts only real dates from 1900 up to today (Brazil), like the server', () => {
    const today = '2026-11-01'
    expect(parseBirth('23/04/2005', today)).toEqual({ iso: '2005-04-23' })
    expect(parseBirth('01/11/2026', today)).toEqual({ iso: '2026-11-01' })
    expect(parseBirth('29/02/2004', today)).toEqual({ iso: '2004-02-29' })
    expect(parseBirth('  ', today)).toEqual({ error: 'required' })
    expect(parseBirth('23/04/05', today)).toEqual({ error: 'invalid' })
    expect(parseBirth('31/04/2005', today)).toEqual({ error: 'invalid' })
    expect(parseBirth('29/02/2005', today)).toEqual({ error: 'invalid' })
    expect(parseBirth('12/12/1899', today)).toEqual({ error: 'invalid' })
    expect(parseBirth('02/11/2026', today)).toEqual({ error: 'future' })
  })

  it('reads the date back in words', () => {
    expect(birthInWords('2005-04-23')).toBe('23 de abril de 2005')
    expect(birthInWords('2010-01-01')).toBe('1 de janeiro de 2010')
  })
})
