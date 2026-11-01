import { todayInBrazil } from '@alga/shared'

/** Keeps digits only and inserts the slashes: "23042005" -> "23/04/2005". */
export function maskBirth(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')
}

export type BirthResult = { iso: string } | { error: 'required' | 'invalid' | 'future' }

/** DD/MM/AAAA -> YYYY-MM-DD with the server's rule: a real calendar date from 1900 on, not after today in Brazil. */
export function parseBirth(text: string, today = todayInBrazil()): BirthResult {
  const v = text.trim()
  if (!v) return { error: 'required' }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  if (!m) return { error: 'invalid' }
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso || iso < '1900-01-01') return { error: 'invalid' }
  if (iso > today) return { error: 'future' }
  return { iso }
}

const words = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
/** "23 de abril de 2005": read back so a swapped day and month is caught before it counts. */
export const birthInWords = (iso: string) => words.format(new Date(`${iso}T12:00:00Z`))
