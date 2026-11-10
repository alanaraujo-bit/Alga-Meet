import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Kbd } from './Kbd'
import { place, originFor, type Align, type Side } from './floating'
import { usePortalTarget } from './portal'
import s from './misc.module.css'

const DELAY = 450
const SKIP_WINDOW = 300
let lastHiddenAt = 0

type TriggerProps = {
  onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

/**
 * Hover/focus tooltip. 450ms delay, then instant while the pointer moves between tooltipped
 * controls (skip window). Keyboard focus shows it immediately; Esc and pointer-down hide it.
 */
export function Tooltip({
  content,
  shortcut,
  side = 'top',
  align = 'center',
  children,
  disabled,
}: {
  content: ReactNode
  shortcut?: string
  side?: Side
  align?: Align
  children: ReactElement<TriggerProps>
  disabled?: boolean
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const hide = useCallback(() => {
    clear()
    setAnchor((a) => {
      if (a) lastHiddenAt = Date.now()
      return null
    })
  }, [])
  const show = (el: HTMLElement, immediate: boolean) => {
    if (disabled || !content) return
    clear()
    if (immediate || Date.now() - lastHiddenAt < SKIP_WINDOW) setAnchor(el)
    else timer.current = setTimeout(() => setAnchor(el), DELAY)
  }

  useEffect(() => {
    if (!anchor) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [anchor, hide])
  useEffect(() => clear, [])
  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  const p = children.props
  const trigger = cloneElement(children, {
    onPointerEnter: (e) => {
      p.onPointerEnter?.(e)
      if (e.pointerType === 'mouse') show(e.currentTarget, false)
    },
    onPointerLeave: (e) => {
      p.onPointerLeave?.(e)
      hide()
    },
    onPointerDown: (e) => {
      p.onPointerDown?.(e)
      hide()
    },
    onFocus: (e) => {
      p.onFocus?.(e)
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, true)
    },
    onBlur: (e) => {
      p.onBlur?.(e)
      hide()
    },
    'aria-describedby': anchor ? id : p['aria-describedby'],
  })

  return (
    <>
      {trigger}
      {anchor && <TooltipBubble id={id} anchor={anchor} side={side} align={align} content={content} shortcut={shortcut} />}
    </>
  )
}

function TooltipBubble({
  id,
  anchor,
  side,
  align,
  content,
  shortcut,
}: {
  id: string
  anchor: HTMLElement
  side: Side
  align: Align
  content: ReactNode
  shortcut?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const target = usePortalTarget()
  const [pos, setPos] = useState<{ left: number; top: number; side: Side } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, side, align, 8))
  }, [anchor, side, align, content])
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={s.tooltip}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        transformOrigin: originFor(pos?.side ?? side),
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <span>{content}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </div>,
    target,
  )
}
