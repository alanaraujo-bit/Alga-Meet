// Pure call-stage geometry (unit-tested).

const GAP = 8
const MIN_W = 200
const MAX_W = 880
/** A watched stream in the grid takes up to this share of the stage height (the rest stays a normal grid). */
const FEATURED_SHARE = 0.64

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
  /** Width of the featured (watched) stream tile; null = plain grid. */
  featured: number | null
  /** Width of every other tile. */
  width: number
  /** Tiles per row for the non-featured tiles. */
  rows: number[]
}

/**
 * The call grid. With a stream being watched (and someone else to show), the stream gets a big 16:9 tile on top
 * (up to 64 % of the height) and everyone else keeps a normal, balanced grid below: priority without hijacking.
 */
export function stageLayout(n: number, w: number, h: number, featured: boolean, gap = GAP): StageLayout {
  if (!featured || n < 2) {
    const g = fitGrid(n, w, h, gap)
    return { featured: null, width: g.width, rows: balancedRows(n, g.cols) }
  }
  const minRest = (MIN_W * 9) / 16
  let bigH = Math.max(0, Math.min(h * FEATURED_SHARE, h - minRest - gap, (w * 9) / 16))
  const g = fitGrid(n - 1, w, h - bigH - gap, gap)
  const rows = balancedRows(n - 1, g.cols)
  // The grid below never shrinks under MIN_W: if its rows don't fit, the stream gives up the height.
  const restH = rows.length * ((g.width * 9) / 16) + (rows.length - 1) * gap
  bigH = Math.max(0, Math.min(bigH, h - gap - restH))
  return { featured: Math.floor((bigH * 16) / 9), width: g.width, rows }
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
