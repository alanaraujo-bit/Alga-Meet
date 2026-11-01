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
