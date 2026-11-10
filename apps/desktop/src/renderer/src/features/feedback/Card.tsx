import { FEEDBACK_KINDS, FEEDBACK_SCREENSHOT_MAX_BYTES, FEEDBACK_TEXT_MAX, kindTakesLog, type FeedbackItem } from '@alga/shared'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { useData } from '@/store/data'
import { Button, IconButton, Spinner, Switch } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { BRAND_ECO, type EcoState } from '@/ui/eco/ecoRules'
import { ArrowLeft, Camera, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { shortDate, useReduced } from '../whatsnew/parts'
import { useAnchor } from './anchor'
import { KIND_ECO, KIND_TONE, canSend, firstName, sendsLog } from './logic'
import {
  captureShot, closeFeedback, currentContext, openFeedback, send, setKind, setLogOn, setShot, setText, showForm, showMine, useFeedback,
} from './store'
import { t, whereText } from './strings'
import s from './feedback.module.css'

const SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ')

/**
 * The Eco reacts for a moment (a kind picked, typing, a screenshot arriving, an empty send) and otherwise shows what
 * is going on (sending, failed, sent). Returns the state and `pulse` for the reactions the card triggers by hand.
 */
function useMood(): [EcoState, (state: EcoState, ms: number) => void] {
  const kind = useFeedback((st) => st.kind)
  const text = useFeedback((st) => st.text)
  const shot = useFeedback((st) => st.shot)
  const phase = useFeedback((st) => st.phase)
  const pane = useFeedback((st) => st.pane)
  const [flash, setFlash] = useState<EcoState | null>('hop')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pulse = useCallback((state: EcoState, ms: number) => {
    clearTimeout(timer.current)
    setFlash(state)
    timer.current = setTimeout(() => setFlash(null), ms)
  }, [])
  const mounted = useRef(false)
  useEffect(() => pulse('hop', 500), [pulse]) // the entrance
  useEffect(() => {
    if (mounted.current) pulse(KIND_ECO[kind], 1100)
  }, [kind, pulse])
  useEffect(() => {
    if (mounted.current && text) pulse('listening', 900)
  }, [text, pulse])
  useEffect(() => {
    if (mounted.current && shot) pulse('streaming', 1000)
  }, [shot, pulse])
  useEffect(() => {
    mounted.current = true
    return () => clearTimeout(timer.current)
  }, [])
  const mood: EcoState = pane === 'sent' ? 'success' : phase === 'sending' ? 'connecting' : phase === 'error' ? 'error' : flash ?? 'idle'
  return [mood, pulse]
}

/** The card: a small, non-modal dialog. The app behind it stays usable (to reproduce the bug, to go to the right screen). */
export default function Card() {
  const pane = useFeedback((st) => st.pane)
  const kind = useFeedback((st) => st.kind)
  const last = useFeedback((st) => st.last)
  const capturing = useFeedback((st) => st.capturing)
  const reduced = useReduced()
  const anchor = useAnchor()
  const [mood, pulse] = useMood()
  const [dropping, setDropping] = useState(false)
  const [shotError, setShotError] = useState<string | null>(null)
  const tone = KIND_TONE[pane === 'sent' && last ? last.kind : kind]

  // Focus comes in on open and goes back to whatever opened the card.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    closeFeedback()
  }

  const takeFile = useCallback((file: File | undefined): boolean => {
    if (!file) return false
    if (!SHOT_TYPES.includes(file.type) || file.size > FEEDBACK_SCREENSHOT_MAX_BYTES) {
      setShotError(t.shot.bad)
      return true
    }
    setShotError(null)
    setShot(file)
    return true
  }, [])
  const hasFiles = (e: DragEvent) => pane === 'form' && e.dataTransfer.types.includes('Files')
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDropping(false)
    takeFile(e.dataTransfer.files[0])
  }

  return (
    <motion.div
      className={s.card}
      role="dialog"
      aria-modal="false"
      aria-label={t.title}
      data-feedback
      data-pane={pane}
      data-dropping={dropping || undefined}
      style={{ ...anchor, '--fb-tone': tone, visibility: capturing ? 'hidden' : undefined } as CSSProperties}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: EASE_IN } }}
      onKeyDown={onKey}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={onDrop}
    >
      <div className={s.light} aria-hidden />
      {pane === 'sent' && !reduced && (
        <div className={s.leaves} data-leaves aria-hidden>
          {[-70, -40, -12, 12, 40, 70].map((r) => (
            <span key={r} className={s.leaf} style={{ '--r': `${r}deg` } as CSSProperties} />
          ))}
        </div>
      )}
      <div className={s.top}>
        {pane === 'mine' && (
          <>
            <IconButton icon={ArrowLeft} label={t.list.back} size="sm" onClick={showForm} />
            <h2 className={s.topTitle}>{t.list.title}</h2>
          </>
        )}
        <span className={s.grow} />
        <IconButton icon={X} label={t.close} shortcut="Esc" size="sm" onClick={closeFeedback} />
      </div>
      {pane !== 'mine' && (
        <div className={cx(s.eco, 'eco-alive')} aria-hidden>
          <Eco size={90} state={mood} spec={{ ...BRAND_ECO, accent: tone }} />
        </div>
      )}
      {pane === 'form' && <Form pulse={pulse} takeFile={takeFile} shotError={shotError} setShotError={setShotError} />}
      {pane === 'sent' && last && <Sent item={last} />}
      {pane === 'mine' && <Mine />}
      {dropping && <div className={s.dropHint}>{t.shot.drop}</div>}
    </motion.div>
  )
}

function Form({ pulse, takeFile, shotError, setShotError }: {
  pulse: (state: EcoState, ms: number) => void
  takeFile: (file: File | undefined) => boolean
  shotError: string | null
  setShotError: (e: string | null) => void
}) {
  const kind = useFeedback((st) => st.kind)
  const text = useFeedback((st) => st.text)
  const shot = useFeedback((st) => st.shot)
  const phase = useFeedback((st) => st.phase)
  const error = useFeedback((st) => st.error)
  const mine = useFeedback((st) => st.mine)
  const area = useRef<HTMLTextAreaElement>(null)
  const [shake, setShake] = useState(false)
  const k = t.kind[kind]
  const left = FEEDBACK_TEXT_MAX - text.length

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const submit = () => {
    if (!canSend(text)) {
      setShake(true)
      pulse('error', 700)
      area.current?.focus()
      return
    }
    void send()
  }
  const onKinds = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = FEEDBACK_KINDS[(FEEDBACK_KINDS.indexOf(kind) + d + FEEDBACK_KINDS.length) % FEEDBACK_KINDS.length]!
    setKind(next)
    e.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus()
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // An image only (a screenshot from Win + Shift + S); text with a picture attached pastes as text.
    const file = e.clipboardData.files[0]
    if (!file?.type.startsWith('image/') || e.clipboardData.getData('text')) return
    e.preventDefault()
    takeFile(file)
  }
  const capture = async () => {
    setShotError(null)
    if (!(await captureShot())) setShotError(t.shot.failed)
    area.current?.focus()
  }

  return (
    <div className={s.pane}>
      <p key={kind} className={s.ask}>{k.ask}</p>
      <div className={s.kinds} role="radiogroup" aria-label={t.kinds} onKeyDown={onKinds}>
        {FEEDBACK_KINDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            data-kind={id}
            aria-checked={id === kind}
            tabIndex={id === kind ? 0 : -1}
            className={s.kind}
            style={{ '--k': KIND_TONE[id] } as CSSProperties}
            onClick={() => {
              setKind(id)
              area.current?.focus()
            }}
          >
            <span className={s.dot} />
            {t.kind[id].label}
          </button>
        ))}
      </div>

      <div className={s.field}>
        <textarea
          ref={area}
          className={cx(s.text, shake && s.shake)}
          aria-label={t.text}
          placeholder={k.placeholder}
          maxLength={FEEDBACK_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onAnimationEnd={() => setShake(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {left <= 200 && <span className={cx(s.count, left <= 0 && s.countOut)} aria-label={t.left(left)}>{left}</span>}
      </div>

      {shot ? (
        <div className={s.shot}>
          <div className={s.thumb}>
            <img src={shot.url} alt={t.shot.alt} />
            <span className={s.thumbX}>
              <IconButton icon={X} label={t.shot.remove} size="sm" onClick={() => setShot(null)} />
            </span>
          </div>
          <p className={s.note}>{t.shot.check}</p>
        </div>
      ) : (
        <div className={s.shot}>
          <Button size="sm" variant="ghost" icon={Camera} onClick={() => void capture()}>{t.shot.capture}</Button>
          <span className={s.note}>{t.shot.hint}</span>
        </div>
      )}
      {shotError && <p className={s.error} role="alert">{shotError}</p>}

      <Goes />

      {phase === 'error' && error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.foot}>
        {!!mine?.length && (
          <button type="button" className={s.link} onClick={() => void showMine()}>{t.mine(mine.length)}</button>
        )}
        <span className={s.grow} />
        <Button variant="primary" loading={phase === 'sending'} onClick={submit}>
          {phase === 'error' ? t.retry : t.send}
        </Button>
      </div>
    </div>
  )
}

/** "Vai junto": what the app attaches by itself, always in sight, and the log's off switch. */
function Goes() {
  const kind = useFeedback((st) => st.kind)
  const logOn = useFeedback((st) => st.logOn)
  const log = useFeedback((st) => st.log)
  const [open, setOpen] = useState(false)
  const cfg = window.alga?.config
  const takes = kindTakesLog(kind)
  const ctx = open ? currentContext() : null
  return (
    <div className={s.goes}>
      <div className={s.goesLine}>
        <span>{t.goes.title}:</span>
        <span className={s.goesWhat}>
          <b>v{cfg?.version ?? '?'}</b> · {cfg?.osVersion ?? 'Windows'}{sendsLog(kind, logOn) && ` · ${t.goes.log}`}
        </span>
        <button type="button" className={s.link} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t.goes.hide : t.goes.see}</button>
      </div>
      {ctx && (
        <div className={s.detail}>
          <dl className={s.facts}>
            <dt>{t.goes.version}</dt><dd>{cfg?.version ?? '?'}</dd>
            <dt>{t.goes.system}</dt><dd>{cfg?.osVersion ?? 'Windows'}</dd>
            <dt>{t.goes.where}</dt><dd>{whereText(ctx)}</dd>
            {ctx.crash && (<><dt>{t.goes.crash}</dt><dd>{t.goes.crashed[ctx.crash]}</dd></>)}
          </dl>
          <p className={s.note}>{t.goes.noNames}</p>
          {takes && (
            <>
              <div className={s.logRow}>
                <span>
                  <span className={s.logTitle}>{t.goes.logRow}</span>
                  <span className={s.note}>{logOn ? t.goes.logOn : t.goes.logOff}</span>
                </span>
                <Switch checked={logOn} onChange={setLogOn} label={t.goes.logRow} />
              </div>
              {logOn && <pre className={s.log} tabIndex={0}>{log === null ? t.goes.logLoading : log || t.goes.logEmpty}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ item }: { item: FeedbackItem }) {
  return (
    <li className={s.row} style={{ '--k': KIND_TONE[item.kind] } as CSSProperties}>
      <span className={s.dot} title={t.kind[item.kind].label} />
      <span className={s.rowText}>{item.text}</span>
      <span className={s.rowMeta}>{shortDate(item.createdAt)}{item.hasScreenshot && ` · ${t.list.withShot}`}</span>
      <span className={s.tag}>{t.received}</span>
    </li>
  )
}

function Sent({ item }: { item: FeedbackItem }) {
  const name = useData((st) => firstName(st.me?.displayName ?? ''))
  const [hover, setHover] = useState(false)
  const done = useRef<HTMLButtonElement>(null)
  useEffect(() => done.current?.focus(), [])
  // Closes by itself unless the pointer is on it (the person is reading, or about to send another).
  useEffect(() => {
    if (hover) return
    const id = setTimeout(closeFeedback, 4000)
    return () => clearTimeout(id)
  }, [hover])
  return (
    <div className={cx(s.pane, s.sent)} role="status" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <h2 className={s.sentTitle}>{t.sent.title(name)}</h2>
      <p className={s.sentBody}>{t.sent.body}</p>
      <ul className={s.list}><Row item={item} /></ul>
      <div className={s.sentFoot}>
        <Button variant="ghost" onClick={() => openFeedback()}>{t.sent.again}</Button>
        <Button ref={done} onClick={closeFeedback}>{t.close}</Button>
      </div>
    </div>
  )
}

function Mine() {
  const mine = useFeedback((st) => st.mine)
  const failed = useFeedback((st) => st.mineError)
  if (mine === null) {
    return (
      <div className={cx(s.pane, s.center)}>
        {failed ? (
          <>
            <p className={s.note}>{t.list.failed}</p>
            <Button size="sm" onClick={() => void showMine()}>{t.retry}</Button>
          </>
        ) : (
          <Spinner label={t.list.loading} />
        )}
      </div>
    )
  }
  if (!mine.length) {
    return (
      <div className={cx(s.pane, s.center)}>
        <span className="eco-alive" aria-hidden><Eco size={64} /></span>
        <p className={s.note}>{t.list.empty}</p>
      </div>
    )
  }
  return (
    <div className={s.pane}>
      <ul className={s.list}>{mine.map((m) => <Row key={m.id} item={m} />)}</ul>
      {failed && <p className={s.error} role="alert">{t.list.failed}</p>}
    </div>
  )
}
