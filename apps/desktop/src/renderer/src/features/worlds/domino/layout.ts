/**
 * Where every tile of a domino table lies, in the table's own frame (x and z on the felt, in metres, the middle of the
 * table at 0, 0): the line of played tiles, the hands standing in front of each chair, the stock. No three.js here, so
 * the arrangement can be tested on its own.
 *
 * Chair n is at SEAT_DIRS[n] from the middle. A tile's own long axis is its x: its lower number is on the -x half.
 * `rot` is a turn about the vertical axis, as three.js applies it: the long axis points at (cos rot, -sin rot).
 */
import { dominoIsDouble, dominoPlace, type DominoPlaced } from '@alga/shared'

/** A tile: long side, short side, thickness. */
export const TILE_L = 0.05
export const TILE_W = 0.025
export const TILE_T = 0.0095
/** Height of the felt over the floor, and half its side. */
export const TOP_Y = 0.76
export const FELT_HALF = 0.46
/** How far from the middle the hands stand, and how far apart the rows of a large hand are. */
export const RACK_D = 0.385
const RACK_ROW = 0.045
const RACK_PITCH = TILE_W + 0.0035
/** Tiles in a row of a hand: more than that (after drawing a lot) stand in a second row behind. */
export const RACK_PER_ROW = 11
/** A row of the line turns before passing this far from the middle. */
export const CHAIN_LIMIT = 0.3
/** The farthest the line gets from the middle across the table (three rows on one end): the stock starts beyond it. */
export const CHAIN_DEPTH = 0.25
/** Direction of each chair from the middle of the table: [x, z]. */
export const SEAT_DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]]

export interface Spot {
  x: number
  z: number
  rot: number
}

const HALF_PI = Math.PI / 2
const L = TILE_L, W = TILE_W

interface Step {
  x: number
  z: number
  hx: number
  hz: number
}

/**
 * One arm of the line: the tiles played on one end, in order, leaving the first tile along x (`dir` 1: towards +x and
 * then turning to +z; -1: the mirror image). A double lies across the path. A row turns before CHAIN_LIMIT, runs a
 * short way across the table and comes back the other way, far enough from the row before for two doubles to pass.
 */
function arm(doubles: readonly boolean[], firstDouble: boolean, dir: 1 | -1): Step[] {
  let hx: number = dir, hz = 0
  // Where the path has reached, the middle of the last square of it, and whether the last tile lies across it.
  let ex = dir * (firstDouble ? W / 2 : L / 2), ez = 0
  let qx = ex - hx * W / 2, qz = 0
  let across = firstDouble
  let row = true
  let rowDir: number = dir
  let rowZ = 0
  const out: Step[] = []
  for (const double of doubles) {
    const e = double ? W : L
    const step = across ? W : W / 2
    if (row && (ex + hx * e) * hx > CHAIN_LIMIT) {
      ex = qx
      ez = qz + dir * step
      rowZ = qz
      hx = 0
      hz = dir
      row = false
    } else if (!row && Math.abs(qz - rowZ) >= 3 * W - 1e-9) {
      rowDir = -rowDir
      ex = qx + rowDir * step
      ez = qz
      hx = rowDir
      hz = 0
      row = true
    }
    out.push({ x: ex + hx * e / 2, z: ez + hz * e / 2, hx, hz })
    ex += hx * e
    ez += hz * e
    qx = ex - hx * W / 2
    qz = ez - hz * W / 2
    across = double
  }
  return out
}

/** `along`: the tile's own +x (its higher number, when not a double) points the way the path goes. */
const spot = (s: Step, double: boolean, along: boolean): Spot =>
  ({ x: s.x, z: s.z, rot: Math.atan2(-s.hz, s.hx) + (double ? HALF_PI : along ? 0 : Math.PI) })

/**
 * Where each tile of the line lies, in the order of `line`. The first tile played (`origin`) is in the middle and the
 * two ends grow away from it, so a tile never moves once it is down.
 */
export function chainLayout(line: readonly DominoPlaced[], origin: number): Spot[] {
  if (!line.length) return []
  const o = Math.min(Math.max(origin, 0), line.length - 1)
  const double = (i: number): boolean => dominoIsDouble(line[i]![0])
  const out = new Array<Spot>(line.length)
  out[o] = { x: 0, z: 0, rot: double(o) ? HALF_PI : line[o]![1] ? Math.PI : 0 }
  const right = line.slice(o + 1), left = line.slice(0, o).reverse()
  arm(right.map((p) => dominoIsDouble(p[0])), double(o), 1).forEach((s, k) => {
    out[o + 1 + k] = spot(s, dominoIsDouble(right[k]![0]), !right[k]![1])
  })
  arm(left.map((p) => dominoIsDouble(p[0])), double(o), -1).forEach((s, k) => {
    out[o - 1 - k] = spot(s, dominoIsDouble(left[k]![0]), !!left[k]![1])
  })
  return out
}

/** Where `tile` would lie if it were played on an end of the line. */
export function chainNext(line: readonly DominoPlaced[], origin: number, tile: number, end: 0 | 1): Spot {
  const next = dominoPlace(line, origin, tile, end)
  const spots = chainLayout(next.line, next.origin)
  return spots[end === 0 ? 0 : spots.length - 1]!
}

/** Tiles on each arm of the line: [left of the first tile, right of it]. */
export const chainArms = (line: readonly DominoPlaced[], origin: number): [number, number] => [origin, Math.max(0, line.length - 1 - origin)]

/** Half sizes of a tile lying at `s`, along x and z. */
export function spotHalf(s: Spot): [number, number] {
  const alongX = Math.abs(Math.cos(s.rot)) > 0.5
  return alongX ? [L / 2, W / 2] : [W / 2, L / 2]
}

/**
 * Where the `n` tiles of the hand of chair `seat` stand: on the felt in front of the chair, left to right as the
 * person sitting there sees them. `scale`: how much larger than life the tiles are drawn (one's own hand).
 */
export function handSpots(seat: number, n: number, scale = 1): { x: number; z: number }[] {
  const [dx, dz] = SEAT_DIRS[seat]!
  // To the right of whoever sits there.
  const rx = dz, rz = -dx
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / RACK_PER_ROW)
    const inRow = Math.min(RACK_PER_ROW, n - r * RACK_PER_ROW)
    const k = (i % RACK_PER_ROW) - (inRow - 1) / 2
    const d = RACK_D + r * RACK_ROW * scale
    out.push({ x: dx * d + rx * k * RACK_PITCH * scale, z: dz * d + rz * k * RACK_PITCH * scale })
  }
  return out
}

/** The stock: face down in the corner between chairs 1 and 2, three to a row. */
export function stockSpot(i: number): Spot {
  return { x: 0.262 + (i % 3) * 0.058, z: -(0.275 + Math.floor(i / 3) * 0.031), rot: 0 }
}

/** The whole set face down in the middle, as it waits for a game: four columns of seven. */
export function pileSpot(i: number): Spot {
  return { x: ((i % 4) - 1.5) * 0.057, z: (Math.floor(i / 4) - 3) * 0.03, rot: 0 }
}
