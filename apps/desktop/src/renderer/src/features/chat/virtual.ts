import { attachmentKind, fitBox, gridRows } from '../../lib/files'
import type { Row } from '../../lib/grouping'

/**
 * Layout math of the virtualized message list (pure, unit-tested). Positions are in "content" pixels: item i
 * spans [offs[i], offs[i + 1]). Measured heights replace estimates as rows mount; the scroll position is kept as an
 * anchor (an item key plus the distance from its top to the viewport top), so pages prepended above, rows above
 * that change height and estimates corrected by measurement never move what the user is looking at.
 */

export type Item = Row | { kind: 'intro'; key: string } | { kind: 'older'; key: string } | { kind: 'error'; key: string }
export interface Anchor {
  key: string
  /** viewportTop - offs[index of key]. */
  delta: number
}
export type Segment = { gap: number } | { index: number }

export function prefixSums(heights: readonly number[]): Float64Array {
  const o = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i++) o[i + 1] = o[i]! + heights[i]!
  return o
}

/** Index of the item that contains y, clamped to the list. */
export function indexAt(offs: Float64Array, y: number): number {
  let lo = 0
  let hi = Math.max(0, offs.length - 2)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offs[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Items intersecting [top - overscan, top + height + overscan], as [start, end). */
export function visibleRange(offs: Float64Array, top: number, height: number, overscan: number): [number, number] {
  const n = offs.length - 1
  if (n <= 0) return [0, 0]
  return [indexAt(offs, top - overscan), Math.min(n, indexAt(offs, top + height + overscan) + 1)]
}

/** What to mount: the range plus pinned items (focus, inline edit) anywhere, with the pixel gaps between them. */
export function segments(offs: Float64Array, [start, end]: [number, number], pinned: readonly number[]): Segment[] {
  const n = offs.length - 1
  const extra = [...new Set(pinned)].filter((i) => i >= 0 && i < n && (i < start || i >= end)).sort((a, b) => a - b)
  const order = [...extra.filter((i) => i < start), ...Array.from({ length: end - start }, (_, k) => start + k), ...extra.filter((i) => i >= end)]
  const out: Segment[] = []
  let at = 0
  for (const i of order) {
    if (i > at) out.push({ gap: offs[i]! - offs[at]! })
    out.push({ index: i })
    at = i + 1
  }
  if (at < n) out.push({ gap: offs[n]! - offs[at]! })
  return out
}

/** Anchor for viewport top y: the first message whose bottom is below y (messages keep their key across pages). */
export function anchorAt(items: readonly Pick<Item, 'key' | 'kind'>[], offs: Float64Array, y: number): Anchor | null {
  if (!items.length) return null
  const i = indexAt(offs, y)
  for (let j = i; j < Math.min(items.length, i + 50); j++) if (items[j]!.kind === 'message') return { key: items[j]!.key, delta: y - offs[j]! }
  return { key: items[i]!.key, delta: y - offs[i]! }
}

// Mirrors chat.module.css / Attachments.tsx closely enough; measurement corrects the rest.
const LINE = 22
const CHAR = 7.4
const ROW_H = [0, 240, 180, 132]

/** Height guess for an item never measured at this width. `width` = the list's client width. */
export function estimateHeight(item: Item, width: number): number {
  switch (item.kind) {
    case 'day':
      return 37
    case 'unread':
      return 17
    case 'intro':
      return 190
    case 'older':
      return 200
    case 'error':
      return 64
    case 'message': {
      const m = item.message
      const text = Math.max(120, Math.min(width - 116, 680))
      let lines = 0
      if (m.content) for (const p of m.content.split('\n')) lines += Math.max(1, Math.ceil((p.length * CHAR) / text))
      let h = 2 + lines * LINE + (item.head ? 32 : 0) + (m.replyToId ? 22 : 0) + (m.reactions.length ? 28 : 0)
      if (m.attachments.length) {
        const images = m.attachments.filter((a) => attachmentKind(a.contentType) === 'image')
        h += 4 + (m.attachments.length - images.length) * 66
        if (images.length === 1) h += fitBox(images[0]!.width, images[0]!.height, 420, 320).height
        else if (images.length) h += gridRows(images.length).reduce((a, c) => a + ROW_H[c]! + 2, 0)
      }
      return h
    }
  }
}
