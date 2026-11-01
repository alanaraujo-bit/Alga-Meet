import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { focusables, originFor, place, type Align, type Side } from './floating'
import s from './overlay.module.css'

/**
 * Anchored panel for rich content (status picker, profile card). Esc / outside click close it
 * and focus returns to the anchor. For lists of actions use Menu instead.
 */
export function Popover({
  anchor,
  onClose,
  side = 'top',
  align = 'start',
  gap = 8,
  label,
  children,
  width,
}: {
  /** Element the popover hangs from; null = closed. */
  anchor: HTMLElement | null
  onClose: () => void
  side?: Side
  align?: Align
  gap?: number
  label: string
  children: ReactNode
  width?: number
}) {
  if (!anchor) return null
  return createPortal(
    <PopoverPanel anchor={anchor} onClose={onClose} side={side} align={align} gap={gap} label={label} width={width}>
      {children}
    </PopoverPanel>,
    document.body,
  )
}

function PopoverPanel({
  anchor,
  onClose,
  side,
  align,
  gap,
  label,
  width,
  children,
}: {
  anchor: HTMLElement
  onClose: () => void
  side: Side
  align: Align
  gap: number
  label: string
  width?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; side: Side } | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, side, align, gap))
    ;(focusables(el)[0] ?? el).focus()
  }, [anchor, side, align, gap])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.contains(t)) close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
      anchor.focus()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close.current)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close.current)
    }
  }, [anchor])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={s.floating}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        transformOrigin: originFor(pos?.side ?? side),
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  )
}
