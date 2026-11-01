import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { Button, IconButton } from './Button'
import { Icon } from './Icon'
import { EASE_IN, EASE_OUT_QUART } from './motion'
import s from './overlay.module.css'

type Kind = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  kind: Kind
  title: string
  description?: string
  action?: { label: string; run: () => void }
}

const useToasts = create<{ items: ToastItem[] }>()(() => ({ items: [] }))
let seq = 0

function push(kind: Kind, title: string, opts?: Omit<ToastItem, 'id' | 'kind' | 'title'>): number {
  const id = ++seq
  useToasts.setState((st) => ({ items: [...st.items.slice(-3), { id, kind, title, ...opts }] }))
  return id
}
export const dismissToast = (id: number) => useToasts.setState((st) => ({ items: st.items.filter((t) => t.id !== id) }))

/** Feedback far from the point of action only. Prefer inline progress/errors where the eye already is. */
export const toast = {
  info: (title: string, opts?: Omit<ToastItem, 'id' | 'kind' | 'title'>) => push('info', title, opts),
  success: (title: string, opts?: Omit<ToastItem, 'id' | 'kind' | 'title'>) => push('success', title, opts),
  error: (title: string, opts?: Omit<ToastItem, 'id' | 'kind' | 'title'>) => push('error', title, opts),
}

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle }

export function ToastHost() {
  const items = useToasts((st) => st.items)
  return (
    <div className={s.toasts} role="region" aria-label="Notificações">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastView({ t }: { t: ToastItem }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = () => {
    timer.current = setTimeout(() => dismissToast(t.id), t.kind === 'error' || t.action ? 7000 : 4000)
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
  }
  useEffect(() => {
    start()
    return stop
  }, [])
  return (
    <motion.div
      layout
      role={t.kind === 'error' ? 'alert' : 'status'}
      className={`${s.toast} ${t.kind === 'success' ? s.toastSuccess : t.kind === 'error' ? s.toastError : ''}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: EASE_IN } }}
      onPointerEnter={stop}
      onPointerLeave={start}
    >
      <span className={s.toastIcon}>
        <Icon icon={ICON[t.kind]} size={16} />
      </span>
      <span className={s.toastText}>
        {t.title}
        {t.description && <span className={s.toastDesc}> {t.description}</span>}
      </span>
      {t.action && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            t.action!.run()
            dismissToast(t.id)
          }}
        >
          {t.action.label}
        </Button>
      )}
      <IconButton icon={X} label="Dispensar" size="sm" onClick={() => dismissToast(t.id)} />
    </motion.div>
  )
}
