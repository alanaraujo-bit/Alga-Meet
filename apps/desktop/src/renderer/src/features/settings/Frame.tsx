import { X, type Glyph } from '@/ui/icons'
import { motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon, IconButton, Kbd } from '@/ui'
import { focusables } from '@/ui/floating'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import s from './settings.module.css'

export interface FrameNav<Id extends string> {
  group: string
  items: Array<{ id: Id; label: string; icon: Glyph }>
}

/**
 * Full-window settings shell (below the title bar), shared by user and space settings: Linear-style nav grouped by
 * label, sticky title, Esc / ✕ close, Tab stays inside, focus returns to what opened it.
 */
export function SettingsFrame<Id extends string>({
  label,
  navTitle,
  nav,
  section,
  onSelect,
  onClose,
  closeLabel,
  heading,
  wide,
  children,
}: {
  /** Dialog name (screen readers). */
  label: string
  /** Small title above the nav (e.g. "Configurações" or the space name). */
  navTitle: ReactNode
  nav: Array<FrameNav<Id>>
  section: Id
  onSelect: (id: Id) => void
  onClose: () => void
  closeLabel: string
  /** Overrides the section title (sub-pages like a single role). */
  heading?: ReactNode
  /** Wider content column (the shop's grid + preview); the nav does not move. */
  wide?: boolean
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Menus, popovers and modals inside close first (they stop propagation on their own Esc).
      if (e.key === 'Escape' && !document.querySelector('[role="menu"], [role="dialog"]:not([data-settings])')) {
        e.preventDefault()
        closeRef.current()
      } else if (e.key === 'Tab' && root.current && !document.querySelector('[role="dialog"]:not([data-settings])')) {
        const f = focusables(root.current)
        const i = f.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          e.preventDefault()
          f[f.length - 1]?.focus()
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault()
          f[0]?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])
  useEffect(() => {
    // Braces matter: Chromium's scrollTo now returns a Promise, which React would take for a cleanup.
    content.current?.scrollTo({ top: 0 })
  }, [section])

  const title = nav.flatMap((g) => g.items).find((it) => it.id === section)?.label
  return (
    <motion.div
      ref={root}
      className={`${s.root} ${wide ? s.wide : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-settings
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: EASE_IN } }}
    >
      <nav className={s.nav} aria-label={label}>
        <div className={s.navInner}>
          <h1 className={s.navTitle}>{navTitle}</h1>
          {nav.map((g) => (
            <div key={g.group} className={s.navGroup}>
              <div className={s.navGroupLabel}>{g.group}</div>
              {g.items.map((it) => (
                <button key={it.id} type="button" className={s.navItem} aria-current={section === it.id ? 'page' : undefined} onClick={() => onSelect(it.id)}>
                  <Icon icon={it.icon} size={16} filled={section === it.id} />
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div ref={content} className={s.content}>
        <div className={s.contentInner}>
          <header className={s.header}>
            <h2 className={s.title}>{heading ?? title}</h2>
            <span className={s.close}>
              <IconButton icon={X} label={closeLabel} shortcut="Esc" size="lg" onClick={onClose} />
              <Kbd>Esc</Kbd>
            </span>
          </header>
          {children}
        </div>
      </div>
    </motion.div>
  )
}

export function Group({ title, description, action, children }: { title?: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.group}>
      {(title || action) && (
        <div className={s.groupHead}>
          {title && <h3 className={s.groupTitle}>{title}</h3>}
          {action}
        </div>
      )}
      {description && <p className={s.groupDesc}>{description}</p>}
      <div className={s.rows}>{children}</div>
    </section>
  )
}

export function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className={s.rowLabel}>
            {label}
          </label>
        ) : (
          <span className={s.rowLabel}>{label}</span>
        )}
        {hint && <span className={s.rowHint}>{hint}</span>}
      </div>
      {children && <div className={s.rowControl}>{children}</div>}
    </div>
  )
}
