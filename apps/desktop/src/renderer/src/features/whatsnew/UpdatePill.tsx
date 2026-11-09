import { releaseText } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../../shared/bridge'
import { useMedia } from '@/media'
import { Button, Icon, Popover } from '@/ui'
import { ArrowCircleUp } from '@/ui/icons'
import { EASE_OUT_QUART } from '@/ui/motion'
import { CategoryGlyph } from './parts'
import { loadUpcoming, useWhatsNew } from './store'
import { t } from './strings'
import s from './whatsnew.module.css'

/** The updater's status as it changes (main pushes every change; the first value is read without starting a check). */
function useUpdateStatus(): UpdateStatus | null {
  const [st, setSt] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    const u = window.alga?.updates
    if (!u) return
    let live = true
    void u.status?.().then((x) => live && setSt(x), () => {})
    const off = u.onStatus((x) => setSt(x))
    return () => {
      live = false
      off()
    }
  }, [])
  return st
}

/**
 * The title bar's quiet update notice, beside the app name: a progress line while it downloads, then "Atualização
 * pronta" with what comes in it. Restarting is the person's call and is not offered mid-call; electron-updater also
 * installs it on quit (autoInstallOnAppQuit), so ignoring it is fine.
 */
export function UpdatePill() {
  const st = useUpdateStatus()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const inCall = useMedia((m) => m.connection.state !== 'idle' && m.connection.state !== 'disconnected')
  const ready = st?.state === 'ready' ? st.version : null
  const downloading = st?.state === 'downloading' && st.percent > 0 ? st : null

  return (
    <>
    <AnimatePresence>
      {(ready || downloading) && (
        <motion.span
          key={ready ? 'ready' : 'dl'}
          className={s.pillWrap}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE_OUT_QUART } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          {ready ? (
            <button type="button" className={s.pill} data-ready aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
              <span className={s.pillDot} aria-hidden />
              {t.update.ready}
            </button>
          ) : (
            <span className={s.pill} role="status">
              <span className={s.pillBar} aria-hidden>
                <span style={{ width: `${downloading!.percent}%` }} />
              </span>
              {t.update.downloading(downloading!.percent)}
            </span>
          )}
        </motion.span>
      )}
    </AnimatePresence>
      {ready && anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} side="bottom" align="start" label={t.update.readyVersion(ready)} width={340}>
          <ReadyCard version={ready} inCall={inCall} onLater={() => setAnchor(null)} />
        </Popover>
      )}
    </>
  )
}

function ReadyCard({ version, inCall, onLater }: { version: string; inCall: boolean; onLater: () => void }) {
  const note = useWhatsNew((st) => st.upcoming[version])
  const locale = useWhatsNew((st) => st.locale)
  useEffect(() => void loadUpcoming(version), [version])
  const text = note ? releaseText(note.content, locale) : null
  const items = note ? [...note.content.items].sort((a, b) => Number(b.highlight) - Number(a.highlight)) : []
  return (
    <div className={s.ready}>
      <div className={s.readyHead}>
        <span className={s.readyIcon} aria-hidden>
          <Icon icon={ArrowCircleUp} size={18} />
        </span>
        <div>
          <p className={s.readyTitle}>{t.update.readyVersion(version)}</p>
          <p className={s.readyBody}>{text?.title ?? t.update.body}</p>
        </div>
      </div>
      {items.length > 0 && (
        <div className={s.readyList}>
          <span className={s.readyLabel}>{t.update.coming}</span>
          <ul>
            {items.slice(0, 3).map((it) => (
              <li key={it.id}>
                <CategoryGlyph category={it.category} size={20} />
                {text!.items[it.id]!.title}
              </li>
            ))}
          </ul>
          {items.length > 3 && <span className={s.readyMore}>{t.update.more(items.length - 3)}</span>}
        </div>
      )}
      {text && <p className={s.readyBody}>{t.update.body}</p>}
      {inCall && <p className={s.readyHint} role="note">{t.update.inCall}</p>}
      <div className={s.readyActions}>
        <Button variant="ghost" size="sm" onClick={onLater}>
          {t.update.later}
        </Button>
        <Button variant="primary" size="sm" disabled={inCall} onClick={() => window.alga.updates.install()}>
          {t.update.restart}
        </Button>
      </div>
    </div>
  )
}
