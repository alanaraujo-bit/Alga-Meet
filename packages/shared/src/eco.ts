import { z } from 'zod'

/**
 * Eco, the mascot people wear when they have no photo (docs/brand/mascote/eco.md). The parts are a closed set: the
 * client draws them, the server only stores which ones a person picked (PATCH /users/@me { eco }).
 */
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
  '#f07a9a', // rose
  '#b9a6f5', // lavender
  '#6ee7b7', // mint
  '#ff8a65', // coral
] as const

export const ECO_EYES = ['bar', 'slit', 'dot', 'line', 'wing', 'almond'] as const
export const ECO_HAIR = ['none', 'braid', 'buns', 'ponytail', 'long', 'wavy', 'fringe'] as const
export const ECO_ACCESSORIES = [
  'none', 'headset', 'cap', 'beanie', 'mask', 'cat', 'shades', 'crown', 'horns', 'bandana', 'scarf', 'earrings', 'cracked',
  'choker', 'clip', 'veil',
] as const

export const EcoSpecSchema = z.object({
  accent: z.enum(ECO_ACCENTS),
  eyes: z.enum(ECO_EYES),
  hair: z.enum(ECO_HAIR),
  accessory: z.enum(ECO_ACCESSORIES),
})
export type EcoSpec = z.infer<typeof EcoSpecSchema>
export type EcoEyes = EcoSpec['eyes']
export type EcoHair = EcoSpec['hair']
export type EcoAccessory = EcoSpec['accessory']
