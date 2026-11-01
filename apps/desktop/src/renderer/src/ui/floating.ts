import type { KeyboardEvent } from 'react'

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const MARGIN = 8

/**
 * Place a floating box next to an anchor: flips to the opposite side when it does not fit,
 * then clamps inside the viewport. Pure so it can be unit-tested.
 */
export function place(
  anchor: Rect,
  size: { width: number; height: number },
  side: Side,
  align: Align,
  gap: number,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): { left: number; top: number; side: Side } {
  const fits = (s: Side) =>
    s === 'top'
      ? anchor.top - gap - size.height >= MARGIN
      : s === 'bottom'
        ? anchor.top + anchor.height + gap + size.height <= viewport.height - MARGIN
        : s === 'left'
          ? anchor.left - gap - size.width >= MARGIN
          : anchor.left + anchor.width + gap + size.width <= viewport.width - MARGIN
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const s = fits(side) || !fits(opposite[side]) ? side : opposite[side]

  let left: number
  let top: number
  if (s === 'top' || s === 'bottom') {
    top = s === 'top' ? anchor.top - gap - size.height : anchor.top + anchor.height + gap
    left =
      align === 'start'
        ? anchor.left
        : align === 'end'
          ? anchor.left + anchor.width - size.width
          : anchor.left + anchor.width / 2 - size.width / 2
  } else {
    left = s === 'left' ? anchor.left - gap - size.width : anchor.left + anchor.width + gap
    top =
      align === 'start'
        ? anchor.top
        : align === 'end'
          ? anchor.top + anchor.height - size.height
          : anchor.top + anchor.height / 2 - size.height / 2
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN))
  top = Math.max(MARGIN, Math.min(top, viewport.height - size.height - MARGIN))
  return { left: Math.round(left), top: Math.round(top), side: s }
}

/** Origin for the scale-in animation, so the box grows out of its anchor. */
export const originFor = (side: Side): string =>
  ({ top: 'bottom center', bottom: 'top center', left: 'center right', right: 'center left' })[side]

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)

/**
 * Arrow keys in a list of controls (rail, channel list): ↑/↓ move the focus to the previous/next control, Home/End
 * to the first/last. Put it on the container's onKeyDown and mark the container `data-arrow-nav` (menu triggers inside
 * then keep ↓ for moving instead of opening).
 */
export function arrowFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = focusables(e.currentTarget)
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
  items[to]!.focus()
}
