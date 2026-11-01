export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Size {
  width: number
  height: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Restore saved bounds onto the display they mostly overlap, pulled fully inside its work area.
 * Bounds on a display that no longer exists (or no saved position) get centered on the primary display.
 */
export function fitBounds(
  saved: { x?: number; y?: number; width: number; height: number } | undefined,
  workAreas: Rect[],
  primary: Rect,
  fallback: Size,
  min: Size,
): Rect {
  const want = { width: saved?.width ?? fallback.width, height: saved?.height ?? fallback.height }
  let area = primary
  let x: number | undefined
  let y: number | undefined
  if (saved?.x !== undefined && saved.y !== undefined) {
    const r = { x: saved.x, y: saved.y, ...want }
    let best = 0
    for (const a of workAreas) {
      const o = overlap(r, a)
      if (o > best) [best, area, x, y] = [o, a, r.x, r.y]
    }
  }
  const width = Math.max(min.width, Math.min(want.width, area.width))
  const height = Math.max(min.height, Math.min(want.height, area.height))
  return {
    x: clamp(x ?? area.x + Math.round((area.width - width) / 2), area.x, area.x + area.width - width),
    y: clamp(y ?? area.y + Math.round((area.height - height) / 2), area.y, area.y + area.height - height),
    width,
    height,
  }
}
