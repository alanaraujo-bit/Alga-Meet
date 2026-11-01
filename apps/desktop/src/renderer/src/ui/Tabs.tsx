import { motion } from 'motion/react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Badge } from './primitives'
import s from './misc.module.css'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  badge?: number
}

/** Arrow-key roving focus shared by Tabs and SegmentedControl. */
function useRoving<T extends string>(items: Array<{ value: T }>, value: T, onChange: (v: T) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.findIndex((x) => x.value === value)
    const next =
      e.key === 'ArrowRight' ? (i + 1) % items.length
      : e.key === 'ArrowLeft' ? (i - 1 + items.length) % items.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    onChange(items[next]!.value)
    ref.current?.querySelectorAll<HTMLElement>('[data-roving]')[next]?.focus()
  }
  return { ref, onKeyDown }
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const { ref, onKeyDown } = useRoving(items, value, onChange)
  return (
    <div ref={ref} role="tablist" aria-label={label} className={s.tabs} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          data-roving
          aria-selected={it.value === value}
          tabIndex={it.value === value ? 0 : -1}
          className={s.tab}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.badge ? <Badge count={it.badge} /> : null}
        </button>
      ))}
    </div>
  )
}

/** Mutually exclusive options with a sliding thumb (spatial continuity). */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const layoutId = useId()
  const { ref, onKeyDown } = useRoving(items, value, onChange)
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={s.segmented} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          data-roving
          aria-checked={it.value === value}
          tabIndex={it.value === value ? 0 : -1}
          className={s.segment}
          onClick={() => onChange(it.value)}
        >
          {it.value === value && <motion.span layoutId={layoutId} className={s.segmentThumb} transition={{ duration: 0.18, ease: [0.165, 0.84, 0.44, 1] }} />}
          <span className={s.segmentLabel}>{it.label}</span>
        </button>
      ))}
    </div>
  )
}
