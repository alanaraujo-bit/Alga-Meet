import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Direção B contrast contract: every token pair the UI actually draws, WCAG 2.x relative luminance.
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'tokens.css'), 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
const tok = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root)
  if (!m) throw new Error(`token --${name} missing`)
  return m[1]!.trim()
}

type RGBA = [number, number, number, number]
function parse(v: string): RGBA {
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1) as RGBA
  const m = /rgba?\(([^)]+)\)/.exec(v)
  if (!m) throw new Error(`not a color: ${v}`)
  const [r, g, b, a = 1] = m[1]!.split(',').map(Number)
  return [r!, g!, b!, a]
}
/** A translucent layer flattened onto an opaque one. */
const over = (top: string, under: RGBA): RGBA => {
  const [r, g, b, a] = parse(top)
  return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1]
}
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (fg: RGBA, bg: RGBA) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a! + 0.05) / (b! + 0.05)
}

const solid = (n: string) => parse(tok(n))
const content = solid('bg-content')
const surfaces: Record<string, RGBA> = {
  app: solid('bg-app'),
  sidebar: solid('bg-sidebar'),
  content,
  raised: solid('bg-raised'),
  overlay: solid('bg-overlay'),
  modal: solid('bg-modal'),
  'glass on content': over(tok('bg-glass'), content),
  // A menu opened over a call tile or an image: the worst realistic underlay is mid-gray media.
  'glass on media': over(tok('bg-glass'), [128, 128, 128, 1]),
  'current row': over(tok('state-current-hover'), solid('bg-sidebar')),
  'hover on raised': over(tok('state-hover'), solid('bg-raised')),
  input: over('rgba(255, 255, 255, 0.035)', solid('bg-modal')),
}

describe('tokens: WCAG AA on every surface', () => {
  for (const text of ['text-primary', 'text-secondary', 'text-tertiary', 'accent'])
    for (const [name, bg] of Object.entries(surfaces))
      it(`${text} on ${name} ≥ 4.5`, () => expect(contrast(solid(text), bg)).toBeGreaterThanOrEqual(4.5))

  for (const text of ['danger', 'warning', 'success', 'live', 'accent-hover'])
    for (const name of ['content', 'raised', 'modal', 'glass on content'])
      it(`${text} text on ${name} ≥ 4.5`, () => expect(contrast(solid(text), surfaces[name]!)).toBeGreaterThanOrEqual(4.5))

  it.each([
    ['on-accent', 'accent-fill'],
    ['on-accent', 'accent-fill-hover'],
    ['on-accent', 'accent-pressed'],
    ['on-danger', 'danger-fill'],
    ['on-danger', 'danger-fill-hover'],
    ['on-live', 'live-fill'],
  ])('%s on %s ≥ 4.5 (fills carry white text)', (fg, bg) => {
    expect(contrast(solid(fg), solid(bg))).toBeGreaterThanOrEqual(4.5)
    // The primary sheen adds ≤ 10 % white at the very top; text sits below it, at ≤ 2 %.
    expect(contrast(solid(fg), over('rgba(255, 255, 255, 0.02)', solid(bg)))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['online', 'idle', 'dnd', 'offline', 'accent'])('%s indicator ≥ 3:1 on chrome and content', (c) => {
    for (const bg of [surfaces.sidebar!, content, surfaces.raised!]) expect(contrast(solid(c), bg)).toBeGreaterThanOrEqual(3)
  })

  it('initials avatar ink reads on its disc', () => {
    expect(contrast(solid('avatar-ink'), solid('avatar-fill'))).toBeGreaterThanOrEqual(4.5)
  })

  it('surfaces step up in luminance: chrome < content < raised < overlay', () => {
    const L = ['bg-app', 'bg-content', 'bg-raised', 'bg-overlay'].map((n) => lum(solid(n)))
    for (let i = 1; i < L.length; i++) expect(L[i]!).toBeGreaterThan(L[i - 1]!)
  })
})

describe('Direção B: no teal left in the renderer', () => {
  const src = join(here, '..')
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(css|tsx?)$/.test(f) && !f.endsWith('.test.ts')) files.push(p)
    }
  }
  walk(src)
  it('the Bioluminescência accent is gone', () => {
    const old = /rgba\((33, 201, 202|77, 220, 220|120, 236, 232|140, 236, 232)|#4ddcdc|#21c9ca|#38b3b3|#061415/i
    expect(files.filter((f) => old.test(readFileSync(f, 'utf8'))).map((f) => f.slice(src.length + 1))).toEqual([])
  })
})
