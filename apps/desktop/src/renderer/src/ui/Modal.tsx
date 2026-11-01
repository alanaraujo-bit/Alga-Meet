import { X } from './icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'
import { focusables } from './floating'
import { EASE_IN, EASE_SHEET } from './motion'
import s from './overlay.module.css'

/** Open modals, topmost last: only the top one reacts to Esc / traps Tab. */
const stack: string[] = []

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 440,
  initialFocus,
  hideClose,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  initialFocus?: RefObject<HTMLElement | null>
  hideClose?: boolean
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <ModalPanel onClose={onClose} title={title} description={description} footer={footer} width={width} initialFocus={initialFocus} hideClose={hideClose}>
          {children}
        </ModalPanel>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function ModalPanel({
  onClose,
  title,
  description,
  children,
  footer,
  width,
  initialFocus,
  hideClose,
}: Omit<Parameters<typeof Modal>[0], 'open'>) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    stack.push(id)
    const el = panel.current
    const first = initialFocus?.current ?? (el && (focusables(el).find((f) => f.dataset.autofocus !== undefined) ?? focusables(el).find((f) => f.tagName === 'INPUT'))) ?? el
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !el) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const f = focusables(el)
        if (f.length === 0) return e.preventDefault()
        const i = f.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && (i <= 0)) {
          e.preventDefault()
          f[f.length - 1]!.focus()
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault()
          f[0]!.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(id), 1)
      // Return focus to whatever opened the modal (if it still exists).
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [id, initialFocus])

  return (
    <div className={s.modalRoot}>
      <motion.div
        className={s.scrim}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE_IN } }}
        onPointerDown={() => closeRef.current()}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={s.modal}
        style={{ width }}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: EASE_SHEET } }}
        exit={{ opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.16, ease: EASE_IN } }}
      >
        <header className={s.modalHeader}>
          <div>
            <h2 id={`${id}-title`} className={s.modalTitle}>
              {title}
            </h2>
            {description && (
              <p id={`${id}-desc`} className={s.modalDesc}>
                {description}
              </p>
            )}
          </div>
          {!hideClose && <IconButton icon={X} label="Fechar" shortcut="Esc" onClick={() => closeRef.current()} />}
        </header>
        {children && <div className={s.modalBody}>{children}</div>}
        {footer && <footer className={s.modalFooter}>{footer}</footer>}
      </motion.div>
    </div>
  )
}
