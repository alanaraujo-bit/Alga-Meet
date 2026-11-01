/** pt-BR date/time formatting for chat. Pure (inject `now` in tests). */

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const dayMonthYear = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const short = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const full = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function dayDiff(a: Date, b: Date): number {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((y - x) / 86_400_000)
}

/** Separator label: "Hoje", "Ontem", "12 de março", "12 de março de 2025". */
export function dayLabel(d: Date, now = new Date()): string {
  const diff = dayDiff(d, now)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d)
}

/** Next to the author name: "Hoje às 14:32", "Ontem às 09:10", "12/03/2026 14:32". */
export function messageTime(d: Date, now = new Date()): string {
  const diff = dayDiff(d, now)
  if (diff === 0) return `Hoje às ${time.format(d)}`
  if (diff === 1) return `Ontem às ${time.format(d)}`
  return `${short.format(d)} ${time.format(d)}`
}

export const clock = (d: Date): string => time.format(d)
export const fullDate = (d: Date): string => full.format(d)

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
}
