/**
 * Eco, the Alga Meet mascot (docs/brand/mascote): a small hooded being whose visor face is a voice meter and whose
 * two antennae are the logo's fronds. Pure rules here (palette, parts, the Eco each person is born with); the drawing
 * lives in Eco.tsx. Everyone without a photo gets an Eco derived from their id: same person, same Eco, on every device.
 */

/** One accent per Eco: outline, antennae and (except on indigo, the brand) the eyes. */
export const ECO_ACCENTS = [
  '#8b8ef7', // indigo (brand)
  '#e5484d', // crimson
  '#3dd6e0', // cyan
  '#a77bf3', // violet
  '#f5a524', // amber
  '#4ade4a', // toxic green
  '#e6edf5', // ice
  '#2fb5a5', // teal
  '#e5459a', // magenta
  '#d6b14a', // gold
  '#f2711c', // orange
  '#5b8bd6', // steel blue
] as const

export const ECO_EYES = ['bar', 'slit', 'dot', 'line'] as const
export type EcoEyes = (typeof ECO_EYES)[number]

export const ECO_ACCESSORIES = ['none', 'headset', 'cap', 'beanie', 'mask', 'cat', 'shades', 'crown', 'horns', 'bandana', 'scarf', 'earrings', 'cracked'] as const
export type EcoAccessory = (typeof ECO_ACCESSORIES)[number]

/** What the app shows in real situations (the face and antennae change, the body never does). */
export type EcoState = 'idle' | 'blink' | 'talking' | 'listening' | 'muted' | 'connecting' | 'streaming' | 'sleeping' | 'error' | 'success'

export interface EcoSpec {
  accent: string
  eyes: EcoEyes
  accessory: EcoAccessory
}

export const BRAND_ECO: EcoSpec = { accent: ECO_ACCENTS[0], eyes: 'bar', accessory: 'none' }

function hash(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995) >>> 0
  h ^= h >>> 13
  return Math.imul(h, 0x5bd1e995) >>> 0
}

/** The Eco a person is born with: three independent picks from their id. */
export function ecoFor(id: string): EcoSpec {
  return {
    accent: ECO_ACCENTS[hash(id, 1) % ECO_ACCENTS.length]!,
    eyes: ECO_EYES[hash(id, 2) % ECO_EYES.length]!,
    accessory: ECO_ACCESSORIES[hash(id, 3) % ECO_ACCESSORIES.length]!,
  }
}

/** Eyes take the accent, except on the brand indigo, where they stay cold white (the logo's other frond). */
export const eyeColor = (accent: string): string => (accent.toLowerCase() === ECO_ACCENTS[0] ? '#f7f8f8' : accent)

/** `#rrggbb` mixed toward black (k < 1) for the darker cloth of accessories. */
export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v * k))).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

/** The disc behind an Eco avatar: near-black with a whisper of the accent, so a list stays calm. */
export const ecoBackdrop = (accent: string): string => `color-mix(in srgb, ${accent} 9%, #121216)`
