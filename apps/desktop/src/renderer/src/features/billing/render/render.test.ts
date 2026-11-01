import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { claim, MAX_PLAYING, stats } from '../engine'
import { HORA_AZUL, TEXT_ON } from '../hora-azul'
import { lookOf } from '../look'
import { constellation, contentRect, FRAME_INSET, FRAME_REACH, halo, inQuadrant, orbits, pencil, ribbon } from './geometry'

// Package B acceptance (growth-plan §5.2 B): resting last frames, contrast, palette, presence quadrant, frames, SKUs.
const here = dirname(fileURLToPath(import.meta.url))
const billing = join(here, '..')
const files = (dir: string, re: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p, re) : re.test(f) && !f.endsWith('.test.ts') ? [p] : []
  })

describe('motion: the last frame of every animation is the resting look', () => {
  const css = [...files(here, /\.module\.css$/), join(billing, 'cosmetics.module.css')].map((p) => [p.slice(billing.length + 1), readFileSync(p, 'utf8')] as const)
  it.each(css)('%s: keyframes never state their end, animations never hold it', (_, text) => {
    for (const [, body] of text.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)) expect(body).not.toMatch(/(^|\s)(to|100%)\s*\{/)
    for (const [decl] of text.matchAll(/animation:[^;]+;/g)) expect(decl).not.toMatch(/\b(forwards|both|infinite)\b/)
  })
})

type RGBA = [number, number, number, number]
function parse(v: string): RGBA {
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1) as RGBA
  const [r, g, b, a = 1] = /rgba?\(([^)]+)\)/.exec(v)![1]!.split(',').map(Number)
  return [r!, g!, b!, a]
}
const over = ([r, g, b, a]: RGBA, u: RGBA): RGBA => [r * a + u[0] * (1 - a), g * a + u[1] * (1 - a), b * a + u[2] * (1 - a), 1]
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (x: RGBA, y: RGBA) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (a! + 0.05) / (b! + 0.05)
}

describe('contrast on themes and nameplates (≥ 7:1 primary, ≥ 4.5:1 secondary)', () => {
  // A theme paints over ink; a plate sits on whatever surface shows the name (panel, raised, overlay, the themes).
  const surfaces = ['#0f1011', '#161718', '#1b1b1d', '#0b0b0c', '#0f0f1a', '#24255a'].map(parse)
  for (const [id, t] of Object.entries(TEXT_ON)) {
    const unders = id.startsWith('theme_') ? t.under.map((c) => over(parse(c), parse('#0f0f1a'))) : t.under.flatMap((c) => surfaces.map((u) => over(parse(c), u)))
    it(id, () => {
      for (const bg of unders) {
        expect(contrast(parse(t.primary), bg)).toBeGreaterThanOrEqual(7)
        expect(contrast(parse(t.secondary), bg)).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

/** sRGB → OKLCH (L, C, H°). */
function oklch([r, g, b]: RGBA): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, Bb), ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360]
}

describe('palette: no state colors and no teal/cyan in an item', () => {
  const sources = [...files(here, /\.(css|tsx?)$/), join(billing, 'hora-azul.ts')]
  const state = /#(61c28e|e6b463|e66e68|c04444|e86885|be395e)\b|var\(--(online|idle|danger|dnd|live|success|warning)/i
  it.each(sources.map((p) => [p.slice(billing.length + 1), p]))('%s', (_, p) => {
    const text = readFileSync(p, 'utf8')
    expect(text).not.toMatch(state)
    const colors = [...text.matchAll(/#[0-9a-f]{6}\b|rgba?\([\d.\s,]+\)/gi)].map((m) => m[0])
    for (const c of colors) {
      const [, C, H] = oklch(parse(c))
      if (C > 0.03) expect([c, H >= 180 && H <= 230]).toEqual([c, false])
    }
  })
})

describe('decorations leave the presence quadrant (bottom right) empty', () => {
  for (const size of [32, 40, 56, 80, 96]) {
    it(`${size} px`, () => {
      const h = halo(size)
      const o = orbits(size)
      const pts = [...h.rim.pts, ...h.edge.pts, ...h.filete.pts, ...h.glint.pts, ...h.caustic.pts, ...o.a.pts, ...o.b.pts, o.bead, ...constellation(size).pts, ...ribbon(size).pts, ...pencil(size).pts]
      expect(pts.filter((p) => inQuadrant(p))).toEqual([])
      // …and stay inside the 140 % box (a few units of overshoot for caps and stars at most).
      expect(Math.max(...pts.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(62)
    })
  }
})

describe('stream frames never cross the video', () => {
  it.each([
    [1280, 720, 16 / 9],
    [1280, 720, 4 / 3],
    [900, 700, 21 / 9],
    [640, 360, 9 / 16],
    [400, 225, 16 / 10],
  ])('box %ix%i, video aspect %f', (w, h, aspect) => {
    const r = contentRect(w, h, aspect)
    // The content rect keeps the video's aspect (the frame hugs content, not the black bars)…
    expect(r.width / r.height).toBeCloseTo(aspect, 6)
    // …and leaves room outside it for everything the frame draws, inside the box.
    expect(Math.min(r.left, r.top, w - r.left - r.width, h - r.top - r.height)).toBeGreaterThanOrEqual(FRAME_REACH)
    expect(FRAME_INSET).toBeGreaterThan(FRAME_REACH)
  })
})

describe('engine: global cap on gestures playing at once', () => {
  it(`lets ${MAX_PLAYING} play, then rests the rest; reduced motion plays none`, () => {
    const g = globalThis as Record<string, unknown>
    let reduce = false
    g.document = { visibilityState: 'visible', documentElement: { classList: { contains: () => reduce } } }
    g.matchMedia = () => ({ matches: false })
    vi.useFakeTimers()
    try {
      const results = Array.from({ length: MAX_PLAYING + 3 }, () => claim(60_000))
      expect(results.filter(Boolean)).toHaveLength(MAX_PLAYING)
      expect(stats.playing).toBe(MAX_PLAYING)
      reduce = true
      stats.playing = 0
      expect(claim(10)).toBe(false)
    } finally {
      vi.useRealTimers()
      delete g.document
      delete g.matchMedia
    }
  })
})

describe('catalog ids', () => {
  it('ignores unknown SKUs and wrong slots in the new slots too', () => {
    expect(
      lookOf({ voiceAura: 'mystery_aura', streamFrame: 'deco_ha_halo_vidro', callReactions: 'reactions_ha_hora_azul', appIcon: 'icon_ha_noite', futureSlot: 'frame_ha_cinema' }),
    ).toEqual({ reactions: 'reactions_ha_hora_azul', icon: 'icon_ha_noite' })
  })

  it('has the 28 items of Coleção 01, five of them heroes, HA-01…HA-28 in order', () => {
    const items = Object.values(HORA_AZUL)
    expect(items.map((m) => m.code)).toEqual(Array.from({ length: 28 }, (_, i) => `HA-${String(i + 1).padStart(2, '0')}`))
    expect(Object.entries(HORA_AZUL).filter(([, m]) => 'hero' in m && m.hero).map(([id]) => id)).toEqual([
      'deco_ha_halo_vidro', 'effect_ha_hora_azul', 'nameplate_ha_crepusculo', 'aura_ha_respiro', 'frame_ha_cinema',
    ])
    // §3.3.4: one-shot gestures stay within 2.4 s.
    expect(Math.max(...items.map((m) => m.ms))).toBeLessThanOrEqual(2400)
  })
})
