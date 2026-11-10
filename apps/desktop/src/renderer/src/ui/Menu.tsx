import { Check, type Glyph } from './icons'
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from './Icon'
import { place, type Align, type Rect, type Side } from './floating'
import { usePortalTarget } from './portal'
import s from './overlay.module.css'

export type MenuEntry =
  | {
      kind?: 'item'
      label: string
      icon?: Glyph
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
      hint?: string
      /** Renders a check on the right (toggle items). */
      checked?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'group'; label: string }

type Item = Extract<MenuEntry, { onSelect: unknown }>
const isItem = (e: MenuEntry): e is Item => e.kind === undefined || e.kind === 'item'

interface OpenMenu {
  items: MenuEntry[]
  anchor: Rect
  side: Side
  align: Align
  /** Opened from the keyboard: highlight the first item. */
  keyboard: boolean
  returnFocus: HTMLElement | null
  label?: string
}

const useMenuStore = create<{ open: OpenMenu | null }>()(() => ({ open: null }))

export function closeMenu(): void {
  const cur = useMenuStore.getState().open
  if (!cur) return
  useMenuStore.setState({ open: null })
  if (cur.returnFocus?.isConnected) cur.returnFocus.focus()
}

export function openMenu(o: Omit<OpenMenu, 'returnFocus' | 'side' | 'align'> & { side?: Side; align?: Align }): void {
  useMenuStore.setState({
    open: { side: 'bottom', align: 'start', ...o, returnFocus: document.activeElement as HTMLElement | null },
  })
}

/** onContextMenu handler that opens a menu at the pointer (or under the element for the keyboard menu key). */
export function contextMenuHandler(items: () => MenuEntry[], label?: string) {
  return (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const list = items()
    if (list.length === 0) return
    // Shift+F10 / the Menu key: Chromium reports button -1 (a right click is 2) and the focused element's position.
    const keyboard = e.button !== 2
    const r = e.currentTarget.getBoundingClientRect()
    openMenu({
      items: list,
      label,
      keyboard,
      anchor: keyboard ? { left: r.left + 8, top: r.top + r.height, width: 0, height: 0 } : { left: e.clientX, top: e.clientY, width: 0, height: 0 },
    })
  }
}

type TriggerProps = {
  onClick?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  'aria-haspopup'?: 'menu'
  'aria-expanded'?: boolean
}

/** Dropdown trigger: clones the child button and opens the menu under it. */
export function MenuButton({
  items,
  children,
  side = 'bottom',
  align = 'start',
  label,
  off,
}: {
  items: () => MenuEntry[]
  children: ReactElement<TriggerProps>
  side?: Side
  align?: Align
  label?: string
  /** No menu right now: the child renders as is and stays the same element, so its focus survives the switch. */
  off?: boolean
}) {
  const open = useMenuStore((st) => st.open)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const expanded = !!open && !!anchorEl && open.returnFocus === anchorEl
  const show = (el: HTMLElement, keyboard: boolean) => {
    el.focus()
    setAnchorEl(el)
    openMenu({ items: items(), anchor: el.getBoundingClientRect(), side, align, keyboard, label })
  }
  const p = children.props
  if (off) return <>{children}</>
  return (
    <>
      {cloneElement(children, {
        'aria-haspopup': 'menu',
        'aria-expanded': expanded,
        onClick: (e) => {
          p.onClick?.(e)
          if (expanded) closeMenu()
          else show(e.currentTarget, e.detail === 0)
        },
        onKeyDown: (e) => {
          p.onKeyDown?.(e)
          // In an arrow-key list (rail) ↓ moves to the next control; Enter/Space still open the menu.
          if (e.key === 'ArrowDown' && !e.currentTarget.closest('[data-arrow-nav]')) {
            e.preventDefault()
            show(e.currentTarget, true)
          }
        },
      })}
    </>
  )
}

/** Mounted once at the app root. */
export function MenuHost() {
  const open = useMenuStore((st) => st.open)
  const target = usePortalTarget()
  if (!open) return null
  return createPortal(<MenuPanel key={`${open.anchor.left},${open.anchor.top}`} menu={open} />, target)
}

function MenuPanel({ menu }: { menu: OpenMenu }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const items = menu.items
  const enabled = items.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0)
  const [active, setActive] = useState<number>(menu.keyboard ? (enabled[0] ?? -1) : -1)
  const typeahead = useRef({ text: '', at: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place(menu.anchor, { width: el.offsetWidth, height: el.offsetHeight }, menu.side, menu.align, menu.anchor.width ? 4 : 2))
  }, [menu])
  // Focus once placed: while still hidden (visibility) the panel cannot take focus and the arrows would go nowhere.
  const placed = pos !== null
  useLayoutEffect(() => {
    if (placed) ref.current?.focus()
  }, [placed])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        // Do not steal focus back to the trigger when clicking elsewhere.
        useMenuStore.setState({ open: null })
      }
    }
    const dismiss = () => useMenuStore.setState({ open: null })
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && dismiss()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const select = (i: number) => {
    const it = items[i]
    if (!it || !isItem(it) || it.disabled) return
    closeMenu()
    it.onSelect()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const at = enabled.indexOf(active)
    const move = (to: number) => {
      e.preventDefault()
      setActive(enabled[(to + enabled.length) % enabled.length] ?? -1)
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(at < 0 ? 0 : at + 1)
      case 'ArrowUp':
        return move(at < 0 ? enabled.length - 1 : at - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(enabled.length - 1)
      case 'Enter':
      case ' ':
        e.preventDefault()
        return select(active)
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        return closeMenu()
      case 'Tab':
        e.preventDefault()
        return closeMenu()
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const t = typeahead.current
      t.text = Date.now() - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase()
      t.at = Date.now()
      const hit = enabled.find((i) => (items[i] as Item).label.toLowerCase().startsWith(t.text))
      if (hit !== undefined) setActive(hit)
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={menu.label ?? menu.returnFocus?.getAttribute('aria-label') ?? undefined}
      tabIndex={-1}
      className={s.menu}
      // A dropdown from a wide trigger (sidebar header, device picker) is at least as wide as it, edges aligned.
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        ...(menu.anchor.width > 200 && { minWidth: menu.anchor.width, maxWidth: Math.max(300, menu.anchor.width) }),
      }}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setActive(-1)}
      onContextMenu={(e) => e.preventDefault()}
      aria-activedescendant={active >= 0 ? `menu-item-${active}` : undefined}
    >
      {items.map((e, i) =>
        e.kind === 'separator' ? (
          <div key={i} role="separator" className={s.menuSep} />
        ) : e.kind === 'group' ? (
          <div key={i} role="presentation" className={s.menuGroup}>
            {e.label}
          </div>
        ) : (
          <button
            key={i}
            id={`menu-item-${i}`}
            type="button"
            role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={e.checked}
            aria-disabled={e.disabled || undefined}
            tabIndex={-1}
            data-active={i === active}
            className={`${s.menuItem} ${e.danger ? s.menuDanger : ''}`}
            onPointerMove={() => !e.disabled && active !== i && setActive(i)}
            onClick={() => select(i)}
          >
            {e.icon && <Icon icon={e.icon} size={16} />}
            <span className={s.menuLabel}>{e.label}</span>
            {e.hint && <span className={s.menuHint}>{e.hint}</span>}
            {e.checked && <Icon icon={Check} size={14} className={s.menuCheck} />}
          </button>
        ),
      )}
    </div>
  )
}
