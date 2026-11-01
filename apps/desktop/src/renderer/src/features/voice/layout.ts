// Pure call-stage geometry (unit-tested).

const GAP = 8
const MIN_W = 200
const MAX_W = 880
/** Stage box height (inside the stage padding and dock clearance) under which the people strip gets smaller. */
const STRIP_SHORT = 620

/** Largest 16:9 tile that fits `n` tiles in the box (tries every column count) and the column count it uses. */
export function fitGrid(n: number, w: number, h: number, gap = GAP): { width: number; cols: number } {
  if (n <= 0 || w <= 0 || h <= 0) return { width: MIN_W, cols: 1 }
  let best = 0
  let bestCols = 1
  let bestScore = 0
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const tw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * (16 / 9))
    // People sit side by side on a landscape screen: a taller-than-wide arrangement must win by >20%.
    const score = rows > cols ? tw * 0.8 : tw
    if (score > bestScore) {
      bestScore = score
      best = tw
      bestCols = cols
    }
  }
  return { width: Math.max(MIN_W, Math.min(MAX_W, Math.floor(best))), cols: Math.max(1, Math.min(bestCols, Math.floor((w + gap) / (MIN_W + gap)) || 1)) }
}

/** Largest 16:9 tile width that fits `n` tiles in the box. */
export const fitTiles = (n: number, w: number, h: number, gap = GAP): number => fitGrid(n, w, h, gap).width

/**
 * Tiles per row, as even as possible (7 in 3 columns = 3·2·2, not 3·3·1): a lone tile on the last row reads as
 * broken. The stage inserts a line break after each row, so a row never fills greedily.
 */
export function balancedRows(n: number, cols: number): number[] {
  if (n <= 0) return []
  const rows = Math.ceil(n / Math.max(1, cols))
  const base = Math.floor(n / rows)
  const extra = n % rows
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0))
}

export interface StageLayout {
  /** Width of every tile. */
  width: number
  /** Tiles per row. */
  rows: number[]
}

/** The call grid: largest 16:9 tile for everyone, in balanced rows. */
export function stageLayout(n: number, w: number, h: number, gap = GAP): StageLayout {
  const g = fitGrid(n, w, h, gap)
  return { width: g.width, rows: balancedRows(n, g.cols) }
}

/** Avatar sizes of the voice-only stage (critique r3 #1): 112 normally, 128 on a big stage with few people, 88 on a
 *  short stage or above 8 people, 64 wherever the larger ones do not fit. */
export type SeatSize = 64 | 88 | 112 | 128
/** Name line under the face: 8 px gap + 22 px chip. */
const SEAT_LABEL = 30
/** A seat is the face plus room for the name on both sides. */
export const seatWidth = (avatar: SeatSize) => avatar + 56

export interface VoiceLayout {
  avatar: SeatSize
  gap: number
  rows: number[]
  /** Height of the seat block (rows × seat + gaps). */
  height: number
}

/**
 * Voice-only stage: bare faces on the stage, no 16:9 boxes. Up to 4 people sit side by side; more go into balanced
 * rows of about √(1.5 n) (5 → 3+2, 7 → 4+3, 9 → 3·3·3, 12 → 4·4·4). The largest size whose rows fit wins.
 */
export function voiceLayout(n: number, w: number, h: number): VoiceLayout {
  const sizes: SeatSize[] = n > 8 || h < 560 ? [88, 64] : n <= 3 && h >= 760 && w >= 1100 ? [128, 112, 88, 64] : [112, 88, 64]
  const want = n <= 4 ? n : Math.ceil(Math.sqrt(1.5 * n))
  let out: VoiceLayout | null = null
  for (const avatar of sizes) {
    const gap = avatar >= 112 ? 48 : 40
    const fit = Math.max(1, Math.floor((w + gap) / (seatWidth(avatar) + gap)))
    const rows = balancedRows(n, Math.min(want, fit))
    const height = rows.length * (avatar + SEAT_LABEL) + Math.max(0, rows.length - 1) * gap
    out = { avatar, gap, rows, height }
    if (height <= h) break
  }
  return out ?? { avatar: 64, gap: 40, rows: [], height: 0 }
}

/** Live cards (someone streaming, nobody watching it big) sit above the faces: 16:9, at most 520 wide, ~half the stage. */
export function cardWidth(k: number, w: number, h: number, gap = 24): number {
  if (k <= 0) return 0
  return Math.max(200, Math.floor(Math.min(520, (w - gap * (k - 1)) / k, ((h * 0.5) * 16) / 9)))
}

/** People under a watched stream: 160×90, or 120×68 when the stage box is short (stage under 720 px). */
export const stripTile = (h: number): { w: number; h: number } => (h < STRIP_SHORT ? { w: 120, h: 68 } : { w: 160, h: 90 })

/**
 * Watching a stream gives it the stage at any headcount: the largest 16:9 that fits above one strip of people.
 * (The stage box already excludes the dock clearance and the side padding.)
 */
export function featuredWidth(w: number, h: number, gap = GAP): number {
  const strip = stripTile(h)
  return Math.max(0, Math.floor(Math.min(w, ((h - strip.h - gap) * 16) / 9)))
}

/**
 * The SFU reports linear amplitude (normal speech ≈ 0.03–0.3), far below the local meter's scale. Map it in dB
 * (−50 dB → 0, −20 dB → 1) so a remote voice glows as clearly as your own.
 */
export function loudness(level: number): number {
  if (level <= 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(level) + 50) / 30))
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

/** Mini-player: the corner nearest to where it was dropped (by its center). */
export function nearestCorner(x: number, y: number, w: number, h: number, vw: number, vh: number): Corner {
  const right = x + w / 2 > vw / 2
  const bottom = y + h / 2 > vh / 2
  return `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as Corner
}
