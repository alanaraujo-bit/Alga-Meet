import { ChevronLeft, ChevronRight, Download, ExternalLink, Maximize, Minimize, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { openExternal } from '@/lib/clipboard'
import { attachmentKind, formatBytes } from '@/lib/files'
import { refreshMessage } from '@/store/actions'
import { useData } from '@/store/data'
import { IconButton } from '@/ui'
import { focusables } from '@/ui/floating'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { saveAttachment } from './Attachments'
import { t } from './strings'
import s from './chat.module.css'

/** One lightbox app-wide. It points at a message (not at URLs) so refreshed signed URLs flow in. */
const useLightbox = create<{ at: { channelId: string; messageId: string; index: number } | null }>()(() => ({ at: null }))
export const openLightbox = (channelId: string, messageId: string, index: number) => useLightbox.setState({ at: { channelId, messageId, index } })
const close = () => useLightbox.setState({ at: null })

export function Lightbox() {
  const at = useLightbox((st) => st.at)
  return createPortal(<AnimatePresence>{at && <Panel key="lightbox" {...at} />}</AnimatePresence>, document.body)
}

function Panel({ channelId, messageId, index }: { channelId: string; messageId: string; index: number }) {
  const attachments = useData((st) => st.messages[channelId]?.byId[messageId]?.attachments)
  const images = useMemo(() => attachments?.filter((x) => attachmentKind(x.contentType) === 'image'), [attachments])
  const [actual, setActual] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const n = images?.length ?? 0
  const a = images?.[Math.min(index, n - 1)]
  const go = (d: number) => {
    if (n > 1) useLightbox.setState({ at: { channelId, messageId, index: (index + d + n) % n } })
    setActual(false)
  }

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])
  // The message (or the whole channel) went away while open.
  useEffect(() => {
    if (!a) close()
  }, [a])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowLeft') go(-1)
    else if (e.key === 'ArrowRight') go(1)
    else if (e.key === '+' || e.key === '=') setActual(true)
    else if (e.key === '-' || e.key === '0') setActual(false)
    else if (e.key === 'Tab' && root.current) {
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

  if (!a) return null
  return (
    <motion.div
      ref={root}
      className={s.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={t.lightbox.label}
      tabIndex={-1}
      onKeyDown={onKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.16, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_IN } }}
    >
      <div className={s.lightboxBar}>
        <div className={s.lightboxTitle}>
          <span className={s.lightboxName}>{a.filename}</span>
          <span className={`${s.lightboxMeta} tnum`}>
            {n > 1 && `${t.lightbox.position(index + 1, n)} · `}
            {a.width && a.height ? `${a.width}×${a.height} · ` : ''}
            {formatBytes(a.size)}
          </span>
        </div>
        <IconButton icon={actual ? Minimize : Maximize} label={actual ? t.lightbox.fit : t.lightbox.actual} shortcut={actual ? '−' : '+'} tooltipSide="bottom" onClick={() => setActual(!actual)} />
        <IconButton icon={ExternalLink} label={t.lightbox.openExternal} tooltipSide="bottom" onClick={() => void refreshMessage(channelId, messageId).then(() => openExternal(useData.getState().messages[channelId]?.byId[messageId]?.attachments.find((x) => x.id === a.id)?.url ?? a.url), () => openExternal(a.url))} />
        <IconButton icon={Download} label={t.lightbox.save} tooltipSide="bottom" onClick={() => void saveAttachment(channelId, messageId, a.id)} />
        <IconButton icon={X} label={t.lightbox.close} shortcut="Esc" tooltipSide="bottom" data-autofocus onClick={close} />
      </div>
      <div className={`${s.lightboxStage} ${actual ? s.lightboxActual : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
        <motion.img
          key={a.url}
          src={a.url}
          alt={a.filename}
          width={a.width}
          height={a.height}
          draggable={false}
          className={s.lightboxImg}
          onClick={() => setActual(!actual)}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: EASE_OUT_QUART } }}
        />
      </div>
      {n > 1 && (
        <>
          <IconButton icon={ChevronLeft} label={t.lightbox.prev} shortcut="←" size="lg" className={`${s.lightboxNav} ${s.lightboxPrev}`} onClick={() => go(-1)} />
          <IconButton icon={ChevronRight} label={t.lightbox.next} shortcut="→" size="lg" className={`${s.lightboxNav} ${s.lightboxNext}`} onClick={() => go(1)} />
        </>
      )}
    </motion.div>
  )
}
