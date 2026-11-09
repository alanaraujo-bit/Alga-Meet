import { releaseText } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useData } from '@/store/data'
import { Button, EmptyState, IconButton, Spinner } from '@/ui'
import { Pencil, Sparkle, WifiOff, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { NoteView } from './NoteView'
import { shortDate } from './parts'
import { closeCenter, useWhatsNew, viewVersion } from './store'
import { t } from './strings'
import s from './whatsnew.module.css'

// Admin only: the editor never loads for anyone else.
const Studio = lazy(() => import('./Studio'))

/** The permanent "Novidades": every version on the left, the chosen one on the right. */
export function Center() {
  const open = useWhatsNew((st) => st.center !== null)
  const [studio, setStudio] = useState(false)
  useEffect(() => {
    if (!open) setStudio(false)
  }, [open])
  return createPortal(
    <AnimatePresence>
      {open && !studio && <Panel key="center" onStudio={() => setStudio(true)} />}
      {open && studio && (
        <Suspense key="studio" fallback={null}>
          <Studio onClose={() => setStudio(false)} />
        </Suspense>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Panel({ onStudio }: { onStudio: () => void }) {
  const notes = useWhatsNew((st) => st.notes)
  const seen = useWhatsNew((st) => st.seen)
  const version = useWhatsNew((st) => st.center?.version ?? null)
  const locale = useWhatsNew((st) => st.locale)
  const admin = useData((st) => st.me?.staffRole === 'admin')
  const installed = window.alga?.config.version
  const root = useRef<HTMLDivElement>(null)
  const current = notes?.find((n) => n.version === version) ?? notes?.[0] ?? null

  useEffect(() => {
    if (!version && notes?.[0]) viewVersion(notes[0].version)
  }, [version, notes])
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]:not([data-whatsnew]), [role="menu"]')) return
      e.preventDefault()
      closeCenter()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!notes?.length) return
    const i = notes.findIndex((n) => n.version === current?.version)
    const next = e.key === 'ArrowDown' || e.key === 'j' ? i + 1 : e.key === 'ArrowUp' || e.key === 'k' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? notes.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const n = notes[Math.max(0, Math.min(notes.length - 1, next))]!
    viewVersion(n.version)
    root.current?.querySelector<HTMLElement>(`[data-version="${n.version}"]`)?.focus()
  }

  return (
    <motion.div
      ref={root}
      className={s.center}
      role="dialog"
      aria-modal="true"
      aria-label={t.center.title}
      data-whatsnew
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: EASE_IN } }}
    >
      <aside className={s.side}>
        <header className={s.sideHead}>
          <h1 className={s.sideTitle}>{t.center.title}</h1>
          <p className={s.sideSub}>{t.center.subtitle}</p>
        </header>
        <div className={s.versions} role="listbox" aria-label={t.center.versions} onKeyDown={onListKey}>
          {notes?.map((n) => {
            const fresh = seen ? !seen.viewed.includes(n.version) : false
            const selected = n.version === current?.version
            return (
              <button
                key={n.version}
                type="button"
                role="option"
                data-version={n.version}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={s.vrow}
                onClick={() => viewVersion(n.version)}
              >
                {selected && <motion.span layoutId="wn-vrow" className={s.vrowBg} transition={{ duration: 0.2, ease: EASE_OUT_QUART }} />}
                <span className={s.vrowTop}>
                  <span className={s.vnum}>{n.version}</span>
                  {n.version === installed && <span className={s.hereTag}>{t.center.installed}</span>}
                  {fresh && <span className={s.freshDot} aria-label={t.center.fresh} />}
                  <span className={s.vdate}>{shortDate(n.publishedAt)}</span>
                </span>
                <span className={s.vtitle}>{releaseText(n.content, locale).title}</span>
              </button>
            )
          })}
        </div>
        {admin && (
          <footer className={s.sideFoot}>
            <Button icon={Pencil} size="sm" onClick={onStudio}>
              {t.center.manage}
            </Button>
          </footer>
        )}
      </aside>

      <section className={s.detail}>
        <div className={s.detailClose}>
          <IconButton icon={X} label={t.center.close} shortcut="Esc" onClick={closeCenter} />
        </div>
        <div className={s.detailScroll}>
          {current ? (
            <NoteView key={current.version} note={current} locale={locale} installed={current.version === installed} />
          ) : notes === null ? (
            <Offline />
          ) : (
            <div className={s.emptyWrap}>
              <EmptyState icon={Sparkle} title={t.center.empty[0]}>
                {t.center.empty[1]}
              </EmptyState>
            </div>
          )}
        </div>
      </section>
    </motion.div>
  )
}

/** Never loaded (no cache, server unreachable): say so calmly; the store keeps retrying. */
function Offline() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 1500)
    return () => clearTimeout(id)
  }, [])
  if (!slow)
    return (
      <div className={s.emptyWrap}>
        <Spinner label={t.center.loading} />
      </div>
    )
  return (
    <div className={s.emptyWrap}>
      <EmptyState icon={WifiOff} eco="sleeping" title={t.center.offline[0]}>
        {t.center.offline[1]}
      </EmptyState>
    </div>
  )
}
