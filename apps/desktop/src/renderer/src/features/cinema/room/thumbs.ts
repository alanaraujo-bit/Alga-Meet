// The timeline thumbnail sprite (R27, made in main by extras.ts makeThumbs): 10 columns of 160 px tiles, tile height
// even round(160·h/w), one tile per 10 s of film, rows capped by WebP's 16383 px. Mirrors main's numbers.
export const THUMB_COLUMNS = 10
export const THUMB_WIDTH = 160
export const THUMB_EVERY_S = 10
const WEBP_MAX = 16383

export const thumbHeight = (width: number, height: number): number => Math.max(2, 2 * Math.round((THUMB_WIDTH / 2) * (height / width)))

/** Tiles in the sprite (a very long film stops at the WebP height cap). */
export function thumbCount(durationS: number, width: number, height: number): number {
  const all = Math.max(1, Math.ceil(durationS / THUMB_EVERY_S))
  const rows = Math.min(Math.ceil(all / THUMB_COLUMNS), Math.floor(WEBP_MAX / thumbHeight(width, height)))
  return Math.min(all, rows * THUMB_COLUMNS)
}

/** The tile showing film time `t`: its rect in the sprite (px) and the sprite's size. */
export function thumbTile(t: number, film: { durationS: number; width: number; height: number }): { x: number; y: number; w: number; h: number; sheetW: number; sheetH: number } {
  const h = thumbHeight(film.width, film.height)
  const count = thumbCount(film.durationS, film.width, film.height)
  const i = Math.min(count - 1, Math.max(0, Math.floor(t / THUMB_EVERY_S)))
  const rows = Math.ceil(count / THUMB_COLUMNS)
  return { x: (i % THUMB_COLUMNS) * THUMB_WIDTH, y: Math.floor(i / THUMB_COLUMNS) * h, w: THUMB_WIDTH, h, sheetW: THUMB_COLUMNS * THUMB_WIDTH, sheetH: rows * h }
}
