import type { ActivityKind } from '@alga/shared'

/** "1:23:45" past an hour, "4:07" before: the live timer (tabular figures keep it still). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** The same span, said (screen readers, tooltips): "há 2 h 05 min", "há 12 min", "agora há pouco". */
export function spokenElapsed(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'agora há pouco'
  const h = Math.floor(min / 60)
  if (!h) return `há ${min} min`
  return `há ${h} h ${String(min % 60).padStart(2, '0')} min`
}

/** Verb + preposition per kind, so a line reads as Portuguese: "Jogando VALORANT", "Programando no VS Code". */
export const PHRASE: Record<ActivityKind, { verb: string; prep: string }> = {
  game: { verb: 'Jogando', prep: '' },
  code: { verb: 'Programando', prep: 'no' },
  creative: { verb: 'Criando', prep: 'no' },
  music: { verb: 'Ouvindo', prep: '' },
  video: { verb: 'Assistindo', prep: 'no' },
  app: { verb: 'Usando', prep: '' },
}

export function sentence(kind: ActivityKind, name: string): string {
  const p = PHRASE[kind]
  return [p.verb, p.prep, name].filter(Boolean).join(' ')
}

/**
 * The icon's own color, for the card's glow and timer: an average of its pixels weighted by opacity and saturation
 * (greys and the transparent margin count little), or null for an icon with no color to speak of. `rgba` = RGBA bytes.
 */
export function vividAverage(rgba: ArrayLike<number>): [number, number, number] | null {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255
    if (a < 0.5) continue
    const R = rgba[i]!
    const G = rgba[i + 1]!
    const B = rgba[i + 2]!
    const sat = (Math.max(R, G, B) - Math.min(R, G, B)) / 255
    const k = a * (0.05 + sat * sat)
    r += R * k
    g += G * k
    b += B * k
    w += k
  }
  if (w < 0.5) return null
  const out: [number, number, number] = [r / w, g / w, b / w]
  // Barely tinted after all: no color is better than a muddy one.
  return (Math.max(...out) - Math.min(...out)) / 255 < 0.12 ? null : out.map(Math.round) as [number, number, number]
}

/** A hue of that color made readable on the dark surface (fixed lightness, capped saturation): "hsl(h s% l%)". */
export function readableTint([r, g, b]: [number, number, number]): string {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
  return `hsl(${Math.round(h)} ${Math.round(Math.min(0.72, Math.max(0.38, s)) * 100)}% 70%)`
}

/** Store art of a Steam game (Valve's public CDN; the CSP allows https images): the wide header or the 2:3 cover. */
export const steamArt = (appId: number, kind: 'header' | 'cover' = 'header') =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${kind === 'cover' ? 'library_600x900.jpg' : 'header.jpg'}`
