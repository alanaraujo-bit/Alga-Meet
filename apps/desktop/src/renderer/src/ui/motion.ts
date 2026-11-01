/** Motion tokens for `motion` (JS side). Mirror of the CSS --ease-* / --dur-* tokens. */
export const EASE_OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as const
export const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1] as const
export const EASE_IN_OUT_CUBIC = [0.645, 0.045, 0.355, 1] as const
export const EASE_SHEET = [0.32, 0.72, 0, 1] as const
export const EASE_IN = [0.55, 0.085, 0.68, 0.53] as const

export const DUR = { fast: 0.1, base: 0.16, pop: 0.18, morph: 0.22, panel: 0.3 } as const
