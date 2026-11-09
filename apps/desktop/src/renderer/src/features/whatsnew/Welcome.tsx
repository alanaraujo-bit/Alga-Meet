import { releaseText, type ReleaseNote } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Modal } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { EASE_OUT_QUART } from '@/ui/motion'
import { highlightsOf } from './logic'
import { CategoryGlyph, MediaFrame, Reactions, useReduced } from './parts'
import { dismissWelcome, openCenter, useWhatsNew } from './store'
import { t } from './strings'
import s from './whatsnew.module.css'

/**
 * "O Alga Meet ficou ainda melhor": after an update, in a quiet moment (store.ts). The highlights on the left, the
 * chosen one on the right with its picture. Close/Esc/Entendi = seen; "Lembrar depois" = back tomorrow.
 */
export function Welcome() {
  const open = useWhatsNew((st) => st.welcome)
  // The modal keeps its content on screen while it animates out: render that from the last open state.
  const last = useRef(open)
  if (open) last.current = open
  const welcome = open ?? last.current
  return (
    <Modal
      open={!!open}
      onClose={() => dismissWelcome()}
      width={760}
      title={welcome ? <WelcomeTitle notes={welcome.notes} /> : ''}
      footer={
        welcome && (
          <div className={s.welcomeFoot}>
            {welcome.preview ? <span className={s.previewTag}>{t.welcome.preview}</span> : <Button variant="ghost" onClick={() => dismissWelcome(true)}>{t.welcome.later}</Button>}
            <span className={s.grow} />
            <Button onClick={() => openCenter(welcome.notes[0]?.version ?? null)} disabled={welcome.preview}>
              {t.welcome.details}
            </Button>
            <Button variant="primary" data-autofocus onClick={() => dismissWelcome()}>
              {t.welcome.got}
            </Button>
          </div>
        )
      }
    >
      {welcome && <Stage notes={welcome.notes} preview={welcome.preview} />}
    </Modal>
  )
}

function WelcomeTitle({ notes }: { notes: ReleaseNote[] }) {
  const welcome = { notes }
  const locale = useWhatsNew((st) => st.locale)
  const reduced = useReduced()
  const [first] = welcome.notes
  const several = welcome.notes.length > 1
  const text = first ? releaseText(first.content, locale) : null
  const oldest = welcome.notes.at(-1)!
  return (
    <span className={s.welcomeHead}>
      <span className={s.welcomeEco} aria-hidden>
        <Eco state={reduced ? 'idle' : 'hop'} size={52} />
      </span>
      <span className={s.welcomeHeadText}>
        <span className={s.eyebrow}>
          {t.welcome.eyebrow}
          <span className={s.versionChip}>{several ? t.welcome.versions(welcome.notes.length) : t.welcome.version(first!.version)}</span>
        </span>
        <span className={s.welcomeTitle}>{text?.title}</span>
        {(several || text?.summary) && <span className={s.welcomeSummary}>{several ? t.welcome.range(oldest.version, first!.version) : text!.summary}</span>}
      </span>
    </span>
  )
}

function Stage({ notes, preview }: { notes: ReleaseNote[]; preview: boolean }) {
  const welcome = { notes, preview }
  const locale = useWhatsNew((st) => st.locale)
  const cards = useMemo(() => highlightsOf(welcome.notes), [welcome.notes])
  const [i, setI] = useState(0)
  const several = welcome.notes.length > 1
  const current = cards[Math.min(i, cards.length - 1)]
  if (!current) return null
  const note = welcome.notes.find((n) => n.version === current.version)!
  const text = releaseText(note.content, locale).items[current.item.id]!

  // ↑↓ move through the list like the rest of the app's lists (roving focus).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + cards.length) % cards.length
    setI(n)
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[n]?.focus()
  }

  return (
    <div className={s.stage}>
      <div className={s.picks} role="tablist" aria-orientation="vertical" aria-label={t.welcome.eyebrow} onKeyDown={onKey}>
        {cards.map((c, n) => {
          const nt = releaseText(welcome.notes.find((x) => x.version === c.version)!.content, locale).items[c.item.id]!
          return (
            <button
              key={`${c.version}:${c.item.id}`}
              type="button"
              role="tab"
              id={`wn-tab-${n}`}
              aria-selected={n === i}
              aria-controls="wn-panel"
              tabIndex={n === i ? 0 : -1}
              className={s.pick}
              onClick={() => setI(n)}
            >
              {n === i && <motion.span layoutId="wn-pick" className={s.pickBg} transition={{ duration: 0.22, ease: EASE_OUT_QUART }} />}
              <CategoryGlyph category={c.item.category} size={28} />
              <span className={s.pickText}>
                <span className={s.pickTitle}>{nt.title}</span>
                <span className={s.pickMeta}>
                  {t.categoryOne[c.item.category]}
                  {several && ` · ${c.version}`}
                </span>
              </span>
            </button>
          )
        })}
        {cards.length > 1 && <span className={s.pickCount} aria-hidden>{t.welcome.of(Math.min(i, cards.length - 1) + 1, cards.length)}</span>}
      </div>
      <div className={s.panelWrap}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${current.version}:${current.item.id}`}
            id="wn-panel"
            role="tabpanel"
            aria-labelledby={`wn-tab-${Math.min(i, cards.length - 1)}`}
            className={s.panel}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT_QUART } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          >
            <MediaFrame media={current.item.media} alt={text.alt} category={current.item.category} />
            <h3 className={s.panelTitle}>{text.title}</h3>
            {text.body && <p className={s.panelBody}>{text.body}</p>}
            <Reactions version={current.version} itemId={current.item.id} disabled={welcome.preview} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
