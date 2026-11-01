/*
 * Avatar decoration geometry (pure: tested in render.test.ts). viewBox -60 -60 120 120 is 140 % of the avatar, so
 * the avatar is the circle of radius R. Angles are SVG degrees: 0 = 3 h, 90 = 6 h, 180 = 9 h, 270 = 12 h; light
 * comes from 11 h (240°). The bottom-right quadrant (0–90°) stays empty: the presence dot lives there.
 * Radii are in viewBox units (they scale with the avatar); `k` converts screen px to units for a given size.
 */

export const R = 300 / 7
export type Pt = [number, number]
export const units = (size: number) => 120 / (1.4 * size)
export const P = (r: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180
  return [r * Math.cos(a), r * Math.sin(a)]
}
const f = (n: number) => (Math.abs(n) < 0.005 ? '0' : n.toFixed(2))
export const line = (pts: readonly Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')
export const closed = (pts: readonly Pt[]) => `${line(pts)}Z`

/** Clockwise arc a1 → a2 (a2 > a1) as an SVG path, plus its sample points (for the quadrant test). */
export function arc(r: number, a1: number, a2: number): { d: string; pts: Pt[] } {
  const [x1, y1] = P(r, a1)
  const [x2, y2] = P(r, a2)
  const pts = Array.from({ length: 13 }, (_, i) => P(r, a1 + ((a2 - a1) * i) / 12))
  return { d: `M${f(x1)} ${f(y1)}A${f(r)} ${f(r)} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${f(x2)} ${f(y2)}`, pts }
}

/** True for a point inside the bottom-right quadrant (with a small margin for stroke caps). */
export const inQuadrant = ([x, y]: Pt, margin = 0) => x > -margin && y > -margin

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/**
 * A band of varying half-width `hw(a)` around a centre radius `rc(a)`, from a1 to a2: ribbon, pencil stroke.
 * Returns the closed outline and its outer edge (for a sheen line).
 */
export function band(a1: number, a2: number, rc: (a: number) => number, hw: (a: number) => number, steps = 48): { d: string; outer: Pt[]; inner: Pt[] } {
  const outer: Pt[] = []
  const inner: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a1 + ((a2 - a1) * i) / steps
    outer.push(P(rc(a) + hw(a), a))
    inner.push(P(rc(a) - hw(a), a))
  }
  return { d: closed([...outer, ...inner.reverse()]), outer, inner: inner.reverse() }
}

// ── Stream frames (HA-24, 25) ──
/** Gap a framed video leaves around itself (letterbox), so the frame never covers a pixel of content. */
export const FRAME_INSET = 8
/** How far a frame draws outside the content rect (HA-24's brackets: 4–5.5 px; HA-25's bevel: 3 px). */
export const FRAME_REACH = 5.5
/** The video's content rect (object-fit: contain inside the letterbox) in a box of w × h, for a video of `aspect`. */
export function contentRect(w: number, h: number, aspect: number) {
  const iw = Math.max(0, w - 2 * FRAME_INSET)
  const ih = Math.max(0, h - 2 * FRAME_INSET)
  const cw = Math.min(iw, ih * aspect)
  const ch = cw / aspect
  return { left: FRAME_INSET + (iw - cw) / 2, top: FRAME_INSET + (ih - ch) / 2, width: cw, height: ch }
}

// ── HA-01 Halo de vidro ──
export function halo(size: number) {
  const k = units(size)
  const small = size <= 40
  const r = R + (small ? 2.6 : 3.6) * k
  return {
    small,
    r,
    // Round caps reach 1–1.5 px past the ends: stop a little short of 6 h and 3 h.
    rim: small ? arc(r, 96, 354) : arc(r, 93, 357),
    /** The glass tube's two edges: the lit outer one, and the inner filete where the indigo refracts. */
    edge: arc(r + 1.15 * k, 95, 355),
    filete: arc(r - 1.1 * k, 96, 354),
    /** 18° specular arc centred on 11 h; the glint group rotates in from 8 h. */
    glint: arc(r + 0.35 * k, 231, 249),
    caustic: arc(r - 0.2 * k, 150, 166),
  }
}

// ── HA-02 Órbita ──
/**
 * One tilted orbit sampled as polylines. The back half (upper, in the orbit's own frame) disappears behind the
 * avatar; anything in the presence quadrant is left out.
 */
export function orbit(tilt: number, rx: number, ry: number): { d: string; pts: Pt[]; at: (t: number) => Pt } {
  const rot = (tilt * Math.PI) / 180
  const at = (t: number): Pt => {
    const a = (t * Math.PI) / 180
    const lx = rx * Math.cos(a)
    const ly = ry * Math.sin(a)
    return [lx * Math.cos(rot) - ly * Math.sin(rot), lx * Math.sin(rot) + ly * Math.cos(rot)]
  }
  const runs: Pt[][] = []
  let cur: Pt[] = []
  // Start on the visible far left so a run never wraps around the 0°/360° seam.
  for (let t = 180; t <= 540; t += 3) {
    const p = at(t)
    const back = Math.sin((t * Math.PI) / 180) < 0
    const hidden = inQuadrant(p, 2) || (back && Math.hypot(p[0], p[1]) < R + 1.2)
    if (hidden) {
      runs.push(cur)
      cur = []
    } else cur.push(p)
  }
  runs.push(cur)
  // What re-emerges on the right, squeezed between the avatar and the presence quadrant, reads as stray hairs:
  // the orbits live on the left and over the top, and end where they pass behind the head.
  const kept = runs.filter((r) => r.length >= 8 && r.reduce((s, [x]) => s + x, 0) / r.length < R * 0.35)
  return { d: kept.map(line).join(''), pts: kept.flat(), at }
}
export function orbits(size: number) {
  const small = size <= 40
  const a = orbit(-18, R + 9.5, R * 0.9)
  const b = orbit(18, R + 9.5, R * 0.9)
  // The bead rests at 10 h (210°) on orbit b, outside the avatar; it arrives along the last 70° of its path.
  let tEnd = 0
  let best = Infinity
  for (let t = 0; t < 360; t += 0.5) {
    const [x, y] = b.at(t)
    const polar = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    const err = Math.abs(polar - 210) + (Math.hypot(x, y) < R + 3 ? 1000 : 0)
    if (err < best) [best, tEnd] = [err, t]
  }
  const rest = b.at(tEnd)
  // Out-quart in time: sample the eased position so the keyframes themselves can be linear.
  const path = Array.from({ length: 16 }, (_, i) => {
    const e = 1 - (1 - i / 15) ** 4
    const [x, y] = b.at(tEnd - 70 * (1 - e))
    return [x - rest[0], y - rest[1]] as Pt
  })
  return { small, a, b, bead: rest, beadPath: path }
}

// ── HA-03 Constelação ──
/** [angle, out (fraction of the 140 % margin), star px, lilac?] in the upper-left arc. */
const STARS = [
  [148, 0.22, 2, true],
  [166, 0.52, 2.5, false],
  [189, 0.28, 2, false],
  [210, 0.62, 3, false],
  [232, 0.3, 2, true],
  [254, 0.56, 2.5, false],
  [280, 0.24, 2, true],
] as const
export function constellation(size: number) {
  const k = units(size)
  const small = size <= 40
  const margin = 60 - R
  const stars = STARS.filter((_, i) => !small || i % 3 !== 2).map(([a, out, px, lilac], i) => ({
    i,
    at: P(R + 2 * k + out * (margin - 4 * k), a),
    r: (Math.max(small ? 2 : 0, px) / 2) * k,
    lilac,
    bright: px === 3,
  }))
  const links = small ? '' : stars.slice(1).map((s, i) => line([stars[i]!.at, s.at])).join('')
  return { small, k, stars, links, pts: stars.map((s) => s.at) }
}

// ── HA-04 Fita de seda ──
export function ribbon(size: number) {
  const small = size <= 40
  const rc = (a: number) => R + 5.4 + 0.7 * Math.sin(((a - 120) / 180) * Math.PI * 2)
  const W = small ? 3.6 : 2.8
  // Narrow to almost nothing at the twist (10 h = 210°); tails cut a little narrower than the body.
  const hw = (a: number) => W * (0.1 + 0.9 * smooth(Math.abs(a - 210) / 26)) * (0.72 + 0.28 * smooth(Math.min(a - 120, 300 - a) / 16))
  const back = band(120, 210, rc, hw, 40)
  const front = band(210, 300, rc, hw, 40)
  return { small, back, front, pts: [...back.outer, ...back.inner, ...front.outer, ...front.inner] }
}

// ── HA-05 Traço de grafite ──
export function pencil(size: number) {
  const k = units(size)
  const t = (a: number, a1: number, a2: number) => (a - a1) / (a2 - a1)
  const wobble = (a: number) => {
    const th = (a * Math.PI) / 180
    return 0.55 * Math.sin(3.1 * th) + 0.35 * Math.sin(7.3 * th + 1)
  }
  const press = (u: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.55
  // Main stroke: 6 h round to just past 2 h (≈ 260° drawn), pressure-shaped 1.5 → 3 px → 1.5 px, the end lifting off.
  const main = band(94, 354, (a) => R + 4.3 + wobble(a) + 2.2 * smooth(t(a, 330, 354)), (a) => ((1.5 + 1.5 * press(t(a, 94, 354))) * k) / 2, 72)
  // The second pass at 2 h ("sobra"): a lighter, thinner stroke riding just outside, the hand going round again.
  const extra = band(292, 338, (a) => R + 6.6 + 0.4 * wobble(a + 40), (a) => ((0.5 + 1.1 * press(t(a, 292, 338))) * k) / 2, 24)
  const core = band(110, 340, (a) => R + 4.3 + wobble(a), (a) => ((0.5 + 0.7 * press(t(a, 110, 340))) * k) / 2, 60)
  return { main, extra, core, pts: [...main.outer, ...main.inner, ...extra.outer, ...extra.inner] }
}
