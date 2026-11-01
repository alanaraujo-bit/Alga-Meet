import { Search } from '@/ui/icons'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon, Popover } from '@/ui'
import { searchEmoji } from './emoji'
import { t } from './strings'
import s from './chat.module.css'

const COLS = 8

/** Compact, searchable emoji grid. Arrows move, Enter picks, typing filters (pt-BR keywords). */
export function EmojiPicker({ anchor, onClose, onPick, side = 'top', align = 'end' }: { anchor: HTMLElement | null; onClose: () => void; onPick: (emoji: string) => void; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  return (
    <Popover anchor={anchor} onClose={onClose} side={side} align={align} label={t.emoji.title} width={316}>
      <EmojiGrid onPick={onPick} />
    </Popover>
  )
}

function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useMemo(() => searchEmoji(q), [q])
  const grid = useRef<HTMLDivElement>(null)
  const move = (to: number) => {
    const n = Math.max(0, Math.min(list.length - 1, to))
    setI(n)
    grid.current?.querySelectorAll<HTMLElement>('[data-emoji]')[n]?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? COLS : e.key === 'ArrowUp' ? -COLS : 0
    if (step) {
      e.preventDefault()
      move(i + step)
    } else if (e.key === 'Enter' && list[i]) {
      e.preventDefault()
      onPick(list[i]!)
    }
  }
  return (
    <div className={s.emoji} onKeyDown={onKey}>
      <label className={s.emojiSearch}>
        <Icon icon={Search} size={14} />
        <input
          value={q}
          placeholder={t.emoji.search}
          aria-label={t.emoji.search}
          onChange={(e) => {
            setQ(e.target.value)
            setI(0)
          }}
        />
      </label>
      <div ref={grid} className={s.emojiGrid} role="listbox" aria-label={t.emoji.title}>
        {list.length === 0 ? (
          <p className={s.emojiNone}>{t.emoji.none}</p>
        ) : (
          list.map((e, n) => (
            <button
              key={e}
              type="button"
              role="option"
              data-emoji
              aria-selected={n === i}
              tabIndex={-1}
              className={s.emojiCell}
              onPointerEnter={() => setI(n)}
              onClick={() => onPick(e)}
            >
              {e}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
