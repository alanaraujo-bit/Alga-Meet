/*
 * Plus app colors (growth-plan §2.2, the `appAccent` slot, only you see it): the same ramp as the indigo of
 * tokens.css (accent L .69 · hover L .76 · fill L .555 · fill-hover .565 · pressed .525, OKLCH) at another hue.
 * Lavanda H 300, Ardósia H 255 (chroma × .62), Grafite neutral (text accent lifted to L .82, fill L .44).
 * accents.test.ts checks: accent text ≥ 4.5:1 on the panel, white on the fills ≥ 4.5:1, no teal/cyan, no state color.
 * The voice ring stays indigo on the stage for everyone else (an accent is a personal UI color, not a cosmetic).
 */
export interface AccentRamp {
  accent: string
  hover: string
  fill: string
  fillHover: string
  pressed: string
  /** accent as "r, g, b" for the translucent tints. */
  rgb: string
}

export const ACCENTS: Record<string, AccentRamp> = {
  accent_lavanda: { accent: '#aa83ea', hover: '#be9df7', fill: '#8356c4', fillHover: '#865ac7', pressed: '#7a4fb7', rgb: '170, 131, 234' },
  accent_ardosia: { accent: '#749ed4', hover: '#8fb4e4', fill: '#4875ae', fillHover: '#4b78b1', pressed: '#416ca2', rgb: '116, 158, 212' },
  accent_grafite: { accent: '#c3c3ca', hover: '#d0d0d6', fill: '#515258', fillHover: '#57575e', pressed: '#494a50', rgb: '195, 195, 202' },
}

/** The default indigo, for the picker swatch. */
export const INDIGO = { accent: '#8b8ef7', fill: '#6163d0' }

const VARS = (r: AccentRamp): Record<string, string> => ({
  '--accent': r.accent,
  '--accent-hover': r.hover,
  '--accent-fill': r.fill,
  '--accent-fill-hover': r.fillHover,
  '--accent-pressed': r.pressed,
  '--accent-tint': `rgba(${r.rgb}, 0.1)`,
  '--accent-tint-strong': `rgba(${r.rgb}, 0.18)`,
  '--accent-glow': `rgba(${r.rgb}, 0.24)`,
  '--state-current': `rgba(${r.rgb}, 0.13)`,
  '--state-current-hover': `rgba(${r.rgb}, 0.17)`,
  '--selection-bg': `rgba(${r.rgb}, 0.34)`,
})
const NAMES = Object.keys(VARS(ACCENTS.accent_lavanda!))

/** Recolors the app (inline on <html>, over tokens.css); unknown or none = back to indigo. */
export function applyAccent(id: string | null | undefined): void {
  const ramp = id ? ACCENTS[id] : undefined
  const st = document.documentElement.style
  if (!ramp) return NAMES.forEach((n) => st.removeProperty(n))
  for (const [n, v] of Object.entries(VARS(ramp))) st.setProperty(n, v)
}
