/**
 * Eco, the Alga Meet mascot (docs/brand/mascote/eco.md): a small hooded being whose visor face is a voice meter and
 * whose two antennae are the logo's fronds. Pure rules here (the Eco each person is born with, colors); the parts
 * are a closed set in @alga/shared (the server stores a person's pick) and the drawing lives in Eco.tsx.
 */
import { ECO_ACCENTS, type EcoAccessory, type EcoEyes, type EcoSpec } from '@alga/shared'

export { ECO_ACCENTS, ECO_ACCESSORIES, ECO_EYES, ECO_HAIR, type EcoAccessory, type EcoEyes, type EcoHair, type EcoSpec } from '@alga/shared'

/** What the app shows in real situations (the face and antennae change, the body never does). */
export type EcoState = 'idle' | 'blink' | 'talking' | 'listening' | 'muted' | 'connecting' | 'streaming' | 'sleeping' | 'error' | 'success'

/** What the drawing needs: a pick, with any accent (a profile accentColor may tint the automatic Eco). */
export type EcoLook = Omit<EcoSpec, 'accent'> & { accent: string }

export const BRAND_ECO: EcoSpec = { accent: ECO_ACCENTS[0], eyes: 'bar', hair: 'none', accessory: 'none' }

/**
 * The automatic Eco is neutral on purpose: no hair, no eyeliner, no gendered accessory (a hash must not decide how
 * someone looks). Hair, winged or almond eyes, choker, clip and veil come only from the person's own pick.
 */
const AUTO_ACCENTS = ECO_ACCENTS.slice(0, 12)
const AUTO_EYES: readonly EcoEyes[] = ['bar', 'slit', 'dot', 'line']
const AUTO_ACCESSORIES: readonly EcoAccessory[] = ['none', 'headset', 'cap', 'beanie', 'mask', 'cat', 'shades', 'crown', 'horns', 'bandana', 'scarf', 'earrings', 'cracked']

function hash(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995) >>> 0
  h ^= h >>> 13
  return Math.imul(h, 0x5bd1e995) >>> 0
}

/** The Eco a person is born with: three independent picks from their id. */
export function ecoFor(id: string): EcoSpec {
  return {
    accent: AUTO_ACCENTS[hash(id, 1) % AUTO_ACCENTS.length]!,
    eyes: AUTO_EYES[hash(id, 2) % AUTO_EYES.length]!,
    hair: 'none',
    accessory: AUTO_ACCESSORIES[hash(id, 3) % AUTO_ACCESSORIES.length]!,
  }
}

/** Eyes take the accent, except on the brand indigo, where they stay cold white (the logo's other frond). */
export const eyeColor = (accent: string): string => (accent.toLowerCase() === ECO_ACCENTS[0] ? '#f7f8f8' : accent)

/** `#rrggbb` mixed toward black (k < 1) for the darker cloth of accessories and hair strands. */
export function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v * k))).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

/** The disc behind an Eco avatar: near-black with a whisper of the accent, so a list stays calm. */
export const ecoBackdrop = (accent: string): string => `color-mix(in srgb, ${accent} 9%, #121216)`
