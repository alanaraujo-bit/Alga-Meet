// Where the music surface sits: the full card rests in the lower-right corner, the mini player in the corner the person
// last threw it to. Positioned by x/y motion values (fixed at 0,0), so dragging, resizing and moving to a corner are one
// spring, on the compositor. Clear of the call's controls at the bottom and of the title bar at the top.
import { animate, useMotionValue, type MotionValue } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Corner } from './store'

const MARGIN = 16
export const SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const

/** The call's controls, when they would sit under the surface at the bottom. */
function bottomClear(width: number, corner: Corner): number {
  const dock = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Controles da chamada"]')?.getBoundingClientRect()
  if (!dock || dock.width === 0) return MARGIN
  const left = corner.endsWith('l') ? MARGIN : window.innerWidth - MARGIN - width
  const overlaps = dock.right > left && dock.left < left + width
  return overlaps ? Math.ceil(window.innerHeight - dock.top + 12) : MARGIN
}

function titlebar(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h'))
  return Number.isFinite(v) ? v : 32
}

export function cornerPoint(corner: Corner, w: number, h: number): { x: number; y: number } {
  const x = corner.endsWith('l') ? MARGIN : window.innerWidth - MARGIN - w
  const y = corner.startsWith('t') ? titlebar() + MARGIN : window.innerHeight - bottomClear(w, corner) - h
  return { x: Math.max(MARGIN, x), y: Math.max(titlebar() + MARGIN, y) }
}

/** The corner nearest to where a dragged box was let go (its center against the window's middle). */
export function nearestCorner(x: number, y: number, w: number, h: number, vw = window.innerWidth, vh = window.innerHeight): Corner {
  const cx = x + w / 2
  const cy = y + h / 2
  return `${cy < vh / 2 ? 't' : 'b'}${cx < vw / 2 ? 'l' : 'r'}` as Corner
}

export interface Float {
  x: MotionValue<number>
  y: MotionValue<number>
  dragging: RefObject<boolean>
  /** Call when a drag ends: springs to the nearest corner and returns it. */
  settle: () => Corner
}

/** Keeps `ref` at `corner`: springs when the corner changes, follows its own size and the window's. */
export function useFloat(ref: RefObject<HTMLElement | null>, corner: Corner): Float {
  const x = useMotionValue(-9999)
  const y = useMotionValue(-9999)
  const dragging = useRef(false)
  const placed = useRef(false)
  const want = useRef(corner)
  want.current = corner

  const place = useCallback((spring: boolean) => {
    const el = ref.current
    if (!el || dragging.current) return
    // Never taller than the room between the title bar and the call's controls (it scrolls inside instead).
    const room = window.innerHeight - titlebar() - MARGIN - bottomClear(el.offsetWidth, want.current)
    el.style.maxHeight = `${Math.max(240, room)}px`
    const p = cornerPoint(want.current, el.offsetWidth, Math.min(el.offsetHeight, room))
    if (!spring || !placed.current) {
      x.set(p.x)
      y.set(p.y)
      placed.current = true
    } else {
      animate(x, p.x, SPRING)
      animate(y, p.y, SPRING)
    }
    // Toasts step aside while the surface sits at the lower right.
    if (want.current === 'br') document.documentElement.style.setProperty('--toast-right', `${Math.ceil(el.offsetWidth + 32)}px`)
    else document.documentElement.style.removeProperty('--toast-right')
  }, [ref, x, y])

  useLayoutEffect(() => place(true), [corner, place])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Growing or shrinking keeps the anchored corner still (no spring: the content animates itself).
    const ro = new ResizeObserver(() => place(false))
    ro.observe(el)
    const onResize = () => place(false)
    window.addEventListener('resize', onResize)
    // The call's controls appear and move (screen share, cinema): look again now and then.
    const id = setInterval(() => place(true), 1000)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      clearInterval(id)
      document.documentElement.style.removeProperty('--toast-right')
    }
  }, [ref, place])

  const settle = useCallback((): Corner => {
    const el = ref.current
    dragging.current = false
    if (!el) return want.current
    const c = nearestCorner(x.get(), y.get(), el.offsetWidth, el.offsetHeight)
    want.current = c
    place(true)
    return c
  }, [ref, x, y, place])

  return { x, y, dragging, settle }
}
