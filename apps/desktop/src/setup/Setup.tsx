import { ECO_ACCENTS, ECO_ACCESSORIES, ECO_EYES, ECO_HAIR, UNINSTALL_REASONS, type EcoSpec, type UninstallReason } from '@alga/shared'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Eco } from '@/ui/eco/Eco'
import { BRAND_ECO, type EcoState } from '@/ui/eco/ecoRules'
import { t as settingsText } from '@/features/settings/strings'
import { boot, hold, live, onHost, send, sendUninstallReason, startDemo, type HostEvent, type Phase } from './bridge'
import { t } from './strings'

const names = settingsText.eco

export function Setup() {
  if (boot.mode === 'update') return <Update />
  if (boot.mode === 'uninstall') return <Uninstall />
  return <Install />
}

/* ── Shared pieces ─────────────────────────────────────────────────────────────────────────────────────────── */

/** Progress as the host reports it, eased so jumps (a big file landing) read as one calm motion. */
function useProgress() {
  const [target, setTarget] = useState({ p: 0, phase: 'preparing' as Phase })
  const [done, setDone] = useState<null | boolean>(null)
  useEffect(
    () =>
      onHost((e: HostEvent) => {
        if (e.type === 'progress') setTarget((cur) => ({ p: Math.max(cur.p, e.p), phase: e.phase }))
        else setDone(e.ok)
      }),
    [],
  )
  return { ...target, done }
}

/** The window is invisible until the first frame is painted (no white flash), then the host shows it. */
function useReady() {
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => send({ type: 'ready' })))
  }, [])
}

/** Fade the card out, then let the host act (close, open the app). */
function useLeave(): [boolean, (then: () => void) => void] {
  const [leaving, setLeaving] = useState(false)
  const leave = useCallback((then: () => void) => {
    setLeaving(true)
    setTimeout(then, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260)
  }, [])
  return [leaving, leave]
}

function Card({ size, aura, leaving, children, onClose, closeLabel }: { size: 'tall' | 'small' | 'medium'; aura: string; leaving: boolean; children: ReactNode; onClose?: () => void; closeLabel?: string }) {
  // Drag the window from anywhere that is not a control.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, [role="radio"], label, input, a')) send({ type: 'drag' })
  }
  return (
    <div className={`card ${size} ${leaving ? 'leaving' : ''}`} style={{ ['--aura' as string]: aura }} onPointerDown={onPointerDown}>
      <div className="aura" aria-hidden />
      <div className="grain" aria-hidden />
      <header className="bar">
        <span className="lockup">
          <Mark />
          Alga Meet
        </span>
        <span className="controls">
          <button type="button" className="ctl" aria-label={t.minimize} onClick={() => send({ type: 'minimize' })}>
            <svg viewBox="0 0 12 12" aria-hidden>
              <path d="M2.5 6h7" />
            </svg>
          </button>
          {onClose && (
            <button type="button" className="ctl" aria-label={closeLabel ?? t.close} onClick={onClose}>
              <svg viewBox="0 0 12 12" aria-hidden>
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </span>
      </header>
      {children}
    </div>
  )
}

/** The logo: the Eco's two fronds. */
function Mark() {
  return (
    <svg className="mark" viewBox="20 2 60 44" aria-hidden>
      <path d="M45 44 C42 34 36 20 24 6 C38 15 45 28 48.5 40 Z" />
      <path d="M55 44 C58 34 64 20 76 6 C62 15 55 28 51.5 40 Z" />
    </svg>
  )
}

function Meter({ p, done, failed, label }: { p: number; done: boolean; failed?: boolean; label: string }) {
  const pct = Math.round(Math.min(1, p) * 100)
  return (
    <div className={`meter ${p === 0 && !done ? 'waiting' : ''} ${failed ? 'failed' : ''}`}>
      <div className="meterRow">
        <span className="meterLabel">{label}</span>
        <span className="meterPct">{done && !failed ? '100%' : `${pct}%`}</span>
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done ? 100 : pct} aria-label={label}>
        <div className="fill" style={{ transform: `scaleX(${done && !failed ? 1 : Math.max(0.015, p)})` }} />
      </div>
    </div>
  )
}

/* ── Install ───────────────────────────────────────────────────────────────────────────────────────────────── */

const AUTO_OPEN_MS = 4200
type Part = 'eyes' | 'hair' | 'accessory'
const PARTS: { key: Part; list: readonly string[]; label: string; name: (v: string) => string }[] = [
  { key: 'eyes', list: ECO_EYES, label: names.eyes, name: (v) => names.eyesNames[v as keyof typeof names.eyesNames] },
  { key: 'hair', list: ECO_HAIR, label: names.hair, name: (v) => names.hairNames[v as keyof typeof names.hairNames] },
  { key: 'accessory', list: ECO_ACCESSORIES, label: names.accessory, name: (v) => names.accessoryNames[v as keyof typeof names.accessoryNames] },
]
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

function Install() {
  useReady()
  const { p, phase, done } = useProgress()
  const [leaving, leave] = useLeave()
  const [arrived, setArrived] = useState(false)
  const [eco, setEco] = useState<EcoSpec>(BRAND_ECO)
  const [touched, setTouched] = useState(false)
  const [trying, setTrying] = useState<EcoSpec | null>(null)
  const [mood, setMood] = useState<EcoState | null>(null)
  const moodTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastTouch = useRef(0)

  useEffect(() => {
    startDemo('install')
    if (hold) return
    const id = setTimeout(() => setArrived(true), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1900)
    return () => clearTimeout(id)
  }, [])

  const react = (m: EcoState, ms: number) => {
    clearTimeout(moodTimer.current)
    setMood(m)
    moodTimer.current = setTimeout(() => setMood(null), ms)
  }
  useEffect(() => {
    if (done === true) react('success', 1600)
    if (done === false) setMood('error')
  }, [done])

  const dress = (patch: Partial<EcoSpec>) => {
    const next = { ...eco, ...patch }
    setEco(next)
    setTouched(true)
    setTrying(null)
    lastTouch.current = Date.now()
    send({ type: 'eco', eco: next })
    react('hop', 650)
  }

  const open = useCallback(() => leave(() => send({ type: 'open' })), [leave])

  // Done: open by itself after a few seconds, unless the person is still dressing their Eco.
  const [countdown, setCountdown] = useState(false)
  useEffect(() => {
    if (done !== true) return
    let id: ReturnType<typeof setTimeout>
    const arm = () => {
      const idle = Date.now() - lastTouch.current
      if (idle < 2500) id = setTimeout(arm, 2500 - idle)
      else {
        setCountdown(true)
        id = setTimeout(open, AUTO_OPEN_MS)
      }
    }
    arm()
    return () => clearTimeout(id)
  }, [done, open, touched, eco])
  useEffect(() => {
    if (countdown && Date.now() - lastTouch.current < 100) setCountdown(false)
  }, [eco, countdown])

  // While files land the Eco scans; once you dress it, it looks at you.
  const state: EcoState = mood ?? (done === false ? 'error' : done || touched ? 'idle' : 'connecting')
  const shown = trying ?? eco
  const label = done === false ? t.install.failed : done ? t.install.ready : t.phase[phase]

  return (
    <Card size="tall" aura={shown.accent} leaving={leaving} onClose={() => (done ? leave(() => send({ type: 'close' })) : send({ type: 'close' }))}>
      <div className={`hero ${arrived ? '' : 'arrive'}`}>
        <div className="floor" />
        <div className="eco-alive">
          <Eco spec={shown} state={state} framing="full" size={168} />
        </div>
      </div>
      <div className={`body ${arrived ? 'in' : ''}`}>
        <h1 className="title">{done === false ? t.install.failedTitle : done ? t.install.doneTitle : t.install.title}</h1>
        <p className="sub">{done === false ? t.install.failedHint : done ? (touched ? t.install.doneEco : t.install.doneSub) : t.install.sub}</p>

        {done !== false && (
          <section className="dresser" aria-label={t.install.dresser}>
            <div className="dresserHead">
              <span>{t.install.dresser}</span>
              <button type="button" className="ghost small" onClick={() => dress({ accent: pick(ECO_ACCENTS), eyes: pick(ECO_EYES), hair: pick(ECO_HAIR), accessory: pick(ECO_ACCESSORIES) })}>
                <svg viewBox="0 0 16 16" aria-hidden className="ico">
                  <path d="M2 4.5h2.2c1.4 0 2.3.7 3.1 1.9l1.4 2.2c.8 1.2 1.7 1.9 3.1 1.9H14M11.8 8.3 14 10.5l-2.2 2.2M2 11.5h2.2c.9 0 1.6-.3 2.2-.8M9.6 5.3c.6-.5 1.3-.8 2.2-.8H14M11.8 2.3 14 4.5l-2.2 2.2" />
                </svg>
                {t.install.shuffle}
              </button>
            </div>
            <div className="swatches" role="radiogroup" aria-label={names.color} onKeyDown={(e) => roving(e, (i) => dress({ accent: ECO_ACCENTS[i]! }), ECO_ACCENTS.length, ECO_ACCENTS.indexOf(eco.accent))}>
              {ECO_ACCENTS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={eco.accent === c}
                  tabIndex={eco.accent === c ? 0 : -1}
                  aria-label={names.colors[i]}
                  title={names.colors[i]}
                  className="swatch"
                  style={{ background: c }}
                  onClick={() => dress({ accent: c })}
                  onPointerEnter={() => setTrying({ ...eco, accent: c })}
                  onPointerLeave={() => setTrying(null)}
                />
              ))}
            </div>
            <div className="steppers">
              {PARTS.map(({ key, list, label: partLabel, name }) => {
                const at = list.indexOf(eco[key])
                const step = (d: number) => dress({ [key]: list[(at + d + list.length) % list.length] } as Partial<EcoSpec>)
                return (
                  <div className="stepper" key={key}>
                    <span className="stepLabel">{partLabel}</span>
                    <div className="stepRow">
                      <button type="button" className="arrow" aria-label={`${partLabel}: ${t.install.previous}`} onClick={() => step(-1)}>
                        <svg viewBox="0 0 12 12" aria-hidden>
                          <path d="M7.5 2.5 4 6l3.5 3.5" />
                        </svg>
                      </button>
                      <span className="stepValue" aria-live="polite">
                        {name(eco[key])}
                      </span>
                      <button type="button" className="arrow" aria-label={`${partLabel}: ${t.install.next}`} onClick={() => step(1)}>
                        <svg viewBox="0 0 12 12" aria-hidden>
                          <path d="M4.5 2.5 8 6 4.5 9.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <footer className="foot">
          {done === true ? (
            <button type="button" className={`primary wide ${countdown ? 'counting' : ''}`} style={{ ['--count' as string]: `${AUTO_OPEN_MS}ms` }} onClick={open} autoFocus>
              {t.install.open}
              <span className="countdown" aria-hidden />
            </button>
          ) : done === false ? (
            <div className="row">
              <button type="button" className="ghost" onClick={() => send({ type: 'close' })}>
                {t.close}
              </button>
              <button type="button" className="primary" onClick={() => send({ type: 'retry' })}>
                {t.install.retry}
              </button>
            </div>
          ) : (
            <Meter p={p} done={false} label={label} />
          )}
        </footer>
      </div>
    </Card>
  )
}

/** Radiogroup keys: arrows move the pick, Home/End jump to the ends. */
function roving(e: KeyboardEvent<HTMLElement>, choose: (i: number) => void, length: number, at: number) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? length - 1 : step === undefined ? -1 : (at + step + length) % length
  if (to < 0) return
  e.preventDefault()
  choose(to)
  requestAnimationFrame(() => (e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[to] ?? null)?.focus())
}

/* ── Update ────────────────────────────────────────────────────────────────────────────────────────────────── */

function Update() {
  useReady()
  const { p, phase, done } = useProgress()
  const [leaving, leave] = useLeave()
  useEffect(() => startDemo('update'), [])
  // Done: the app is starting; say so for a moment, then step aside.
  useEffect(() => {
    if (done === true) {
      const id = setTimeout(() => leave(() => send({ type: 'close' })), 1500)
      return () => clearTimeout(id)
    }
  }, [done, leave])
  return (
    <Card size="small" aura={BRAND_ECO.accent} leaving={leaving} onClose={done === false ? () => send({ type: 'close' }) : undefined}>
      <div className="update">
        <div className="updateFace eco-alive">
          <Eco state={done === false ? 'error' : done ? 'success' : 'connecting'} framing="full" size={78} />
        </div>
        <div className="updateText">
          <h1 className="title smallTitle">{done === false ? t.update.failed : done ? t.update.doneTitle : t.update.title}</h1>
          <p className="sub">{done === false ? t.update.failedHint : done ? t.update.doneSub : t.update.sub(boot.version)}</p>
          {done !== false && <Meter p={p} done={!!done} label={done ? t.update.opening : t.phase[phase]} />}
        </div>
      </div>
    </Card>
  )
}

/* ── Uninstall ─────────────────────────────────────────────────────────────────────────────────────────────── */

function Uninstall() {
  useReady()
  const { p, done } = useProgress()
  const [leaving, leave] = useLeave()
  const [deleteData, setDeleteData] = useState(false)
  const [going, setGoing] = useState(false)
  const [hover, setHover] = useState<'stay' | 'go' | null>(null)
  const [reason, setReason] = useState<UninstallReason | null>(null)
  const [sent, setSent] = useState(false)

  const cancel = () => leave(() => send({ type: 'close' }))
  const confirm = () => {
    setGoing(true)
    send({ type: 'uninstall', deleteData })
    if (!live) startDemo('uninstall')
  }
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !going && cancel()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })
  // Done: say goodbye, then close by itself, unless an answer is half written.
  useEffect(() => {
    if (done === true && (!reason || sent)) {
      const id = setTimeout(() => leave(() => send({ type: 'close' })), sent ? 5000 : 12000)
      return () => clearTimeout(id)
    }
  }, [done, leave, reason, sent])

  // The Eco listens while you decide, droops as its files go, and falls asleep at the end; its color drains with them.
  const state: EcoState = sent && reason === 'reinstalling' ? 'success' : done === true ? 'sleeping' : done === false ? 'error' : going ? (p > 0.45 ? 'muted' : 'idle') : hover === 'go' ? 'muted' : hover === 'stay' ? 'success' : 'listening'
  const drain = done === true ? 1 : going ? Math.min(1, p) : 0

  return (
    <Card size="medium" aura={`color-mix(in srgb, ${BRAND_ECO.accent} ${Math.round(100 - drain * 85)}%, #2a2a33)`} leaving={leaving} onClose={going && done === null ? undefined : cancel} closeLabel={done ? t.close : t.uninstall.cancel}>
      <div className={`hero heroShort ${going ? 'heroSmall' : ''}`}>
        <div className="floor" style={{ opacity: 1 - drain * 0.8 }} />
        <div className="eco-alive drain" style={{ ['--drain' as string]: drain }}>
          <Eco state={state} framing="full" size={going ? 92 : 142} />
        </div>
      </div>
      <div className="body in">
        <h1 className="title">
          {done === true ? (reason === 'reinstalling' ? t.uninstall.doneSoon : t.uninstall.doneTitle) : done === false ? t.uninstall.failedTitle : going ? t.uninstall.going : t.uninstall.title}
        </h1>
        {(!going || (done !== null && (sent || done === false))) && <p className="sub">{done === true ? t.uninstall.doneSub : done === false ? t.uninstall.failedHint : t.uninstall.sub}</p>}
        {going && done !== false && <Survey reason={reason} sent={sent} onPick={setReason} onSend={(note) => (sendUninstallReason(reason!, note), setSent(true))} />}
        {!going && (
          <label className="toggle">
            <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
            <span className="switch" aria-hidden />
            <span>
              <span className="toggleTitle">{t.uninstall.deleteData}</span>
              <span className="toggleHint">{t.uninstall.deleteDataHint}</span>
            </span>
          </label>
        )}
        <footer className="foot">
          {!going ? (
            <div className="row">
              <button type="button" className="ghost" onClick={cancel} onPointerEnter={() => setHover('stay')} onPointerLeave={() => setHover(null)} autoFocus>
                {t.uninstall.cancel}
              </button>
              <button type="button" className="danger" onClick={confirm} onPointerEnter={() => setHover('go')} onPointerLeave={() => setHover(null)}>
                {t.uninstall.confirm}
              </button>
            </div>
          ) : done === null ? (
            <Meter p={p} done={false} label={t.uninstall.removing} />
          ) : (
            // Never steal focus from a note being typed (Enter there sends the answer, not "Fechar").
            <button type="button" className="ghost wide" onClick={() => leave(() => send({ type: 'close' }))} autoFocus={!reason || sent}>
              {t.close}
            </button>
          )}
        </footer>
      </div>
    </Card>
  )
}

/** "Antes de ir": one tap on a reason, an optional line, and a thank-you. Never in the way of leaving. */
function Survey({ reason, sent, onPick, onSend }: { reason: UninstallReason | null; sent: boolean; onPick: (r: UninstallReason) => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('')
  if (sent) return <p className="thanks" role="status">{t.survey.thanks}</p>
  return (
    <section className="survey" aria-label={t.survey.title}>
      <span className="surveyTitle">{t.survey.title}</span>
      <span className="surveyHint">{t.survey.hint}</span>
      <div className="chips" role="radiogroup" aria-label={t.survey.title} onKeyDown={(e) => roving(e, (i) => onPick(UNINSTALL_REASONS[i]!), UNINSTALL_REASONS.length, reason ? UNINSTALL_REASONS.indexOf(reason) : 0)}>
        {UNINSTALL_REASONS.map((r, i) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} tabIndex={(reason ? reason === r : i === 0) ? 0 : -1} className="chip" onClick={() => onPick(r)}>
            {t.survey.reasons[r]}
          </button>
        ))}
      </div>
      {reason && (
        <form className="noteRow" onSubmit={(e) => (e.preventDefault(), onSend(note))}>
          <input className="note" value={note} maxLength={280} placeholder={t.survey.note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <button type="submit" className="primary small">
            {t.survey.send}
          </button>
        </form>
      )}
    </section>
  )
}
