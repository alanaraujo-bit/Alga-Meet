// Pure call-stage geometry (unit-tested).

const GAP = 8
const MIN_W = 200
const MAX_W = 880

/** Largest 16:9 tile width that fits `n` tiles in the box (tries every column count). */
export function fitTiles(n: number, w: number, h: number, gap = GAP): number {
  if (n <= 0 || w <= 0 || h <= 0) return MIN_W
  let best = 0
  let bestScore = 0
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const tw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * (16 / 9))
    // People sit side by side on a landscape screen: a taller-than-wide arrangement must win by >20%.
    const score = rows > cols ? tw * 0.8 : tw
    if (score > bestScore) {
      bestScore = score
      best = tw
    }
  }
  return Math.max(MIN_W, Math.min(MAX_W, Math.floor(best)))
}

/**
 * The SFU reports linear amplitude (normal speech ≈ 0.03–0.3), far below the local meter's scale. Map it in dB
 * (−50 dB → 0, −20 dB → 1) so a remote voice glows as clearly as your own.
 */
export function loudness(level: number): number {
  if (level <= 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(level) + 50) / 30))
}
