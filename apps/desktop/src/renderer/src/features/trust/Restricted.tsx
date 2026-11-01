import type { AccountRestriction, AppealView } from '@alga/shared'
import { AlertCircle, CheckCircle2, Clock } from '@/ui/icons'
import { motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { api, ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useSession } from '@/store/session'
import { Button, Icon } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { LogoMark } from '../app/Logo'
import { DocLink, useLegal } from './legal'
import { RULE, cap, longDate, longDateTime, t } from './strings'
import a from '../auth/auth.module.css'
import s from './trust.module.css'

const back = () => useSession.setState({ restricted: null })

/**
 * Login answered 403 with a restriction (or the birth-date declaration was under the minimum age). Says what, why
 * (the rule category only; CSAM decisions arrive as the generic reason), until when, and lets the person appeal with
 * the one-hour token the login returned. Nothing here works with a session: there is none.
 */
export function RestrictedScreen({ restriction: r }: { restriction: AccountRestriction }) {
  const { info } = useLegal()
  const underage = r.reason === 'underage'
  return (
    <main className={a.screen}>
      <motion.div
        className={`${a.card} ${s.wideCard}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT_QUART } }}
      >
        <div className={a.mark}>
          <LogoMark size={28} />
        </div>
        <h1 className={a.title}>{r.type === 'banned' ? t.restricted.bannedTitle : t.restricted.suspendedTitle}</h1>
        <p className={a.subtitle}>
          {underage ? t.restricted.underageBody(r.until && longDate(r.until)) : r.type === 'banned' || !r.until ? t.restricted.noEnd : t.restricted.until(longDateTime(r.until))}
        </p>
        <dl className={s.facts}>
          <div className={s.fact}>
            <dt>{t.restricted.rule}</dt>
            <dd>{cap(RULE[r.reason])}</dd>
          </div>
        </dl>
        <Appeal r={r} />
        <p className={`${a.switch} ${a.links}`}>
          <button type="button" className={a.link} onClick={back}>
            {t.restricted.back}
          </button>
          {info && <DocLink url={info.guidelinesUrl}>{t.restricted.guidelines}</DocLink>}
        </p>
      </motion.div>
    </main>
  )
}

function Note({ kind, children }: { kind: 'ok' | 'wait' | 'info'; children: string }) {
  return (
    <div className={`${s.note} ${kind === 'ok' ? s.noteOk : ''}`} role="status">
      <Icon icon={kind === 'ok' ? CheckCircle2 : kind === 'wait' ? Clock : AlertCircle} size={14} />
      <span>{children}</span>
    </div>
  )
}

function Appeal({ r }: { r: AccountRestriction }) {
  const [status, setStatus] = useState<AppealView['status'] | null>(r.appealStatus)
  const [sent, setSent] = useState(false)
  const [expired, setExpired] = useState(false)
  if (sent) return <Note kind="ok">{t.restricted.appealSent}</Note>
  if (status === 'open') return <Note kind="wait">{t.restricted.appealOpen}</Note>
  if (status === 'rejected') return <Note kind="info">{t.restricted.appealRejected}</Note>
  if (status === 'upheld') return <Note kind="ok">{t.restricted.appealUpheld}</Note>
  if (!r.appealDeadline || !r.actionId) return <Note kind="info">{t.restricted.appealClosed}</Note>
  if (expired || !r.appealToken) return <Note kind="info">{t.restricted.appealExpired}</Note>
  return (
    <AppealForm
      body={t.restricted.appealBody(longDate(r.appealDeadline))}
      hint={r.reason === 'underage' ? t.restricted.underageAppealHint : undefined}
      send={(message) => api<AppealView>('POST', '/appeals', { actionId: r.actionId, message, appealToken: r.appealToken })}
      onSent={() => setSent(true)}
      onAlready={() => setStatus('open')}
      onUnauthorized={() => setExpired(true)}
    />
  )
}

/** Shared by the restricted screen (appeal token) and Configurações › Privacidade (session, for warnings). */
export function AppealForm({
  body,
  hint,
  send,
  onSent,
  onAlready,
  onUnauthorized,
  formId,
  onBusy,
  title = true,
}: {
  body?: string
  hint?: string
  send: (message: string) => Promise<unknown>
  onSent: () => void
  onAlready: () => void
  onUnauthorized?: () => void
  /** In a modal: the submit button sits in the modal footer (`form={formId}`), so none is drawn here. */
  formId?: string
  onBusy?: (busy: boolean) => void
  /** Off inside a modal that already says it. */
  title?: boolean
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusyState] = useState(false)
  const setBusy = (b: boolean) => {
    setBusyState(b)
    onBusy?.(b)
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (text.trim().length < 10) return setError(t.restricted.appealShort)
    setBusy(true)
    setError(null)
    try {
      await send(text.trim())
      onSent()
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiRequestError && err.status === 409) return onAlready()
      if (err instanceof ApiRequestError && err.status === 401 && onUnauthorized) return onUnauthorized()
      setError(errorText(err))
    }
  }
  return (
    <form id={formId} className={s.appeal} onSubmit={submit} noValidate>
      <div className={s.appealHead}>
        {title && <h2 className={s.appealTitle}>{t.restricted.appealTitle}</h2>}
        {body && <p className={s.appealBody}>{body}</p>}
        {hint && <p className={s.appealBody}>{hint}</p>}
      </div>
      <label className={s.textField}>
        <span className={s.textLabel}>{t.restricted.appealLabel}</span>
        <textarea
          className={`${s.textarea} ${error ? s.textareaInvalid : ''}`}
          rows={5}
          maxLength={2000}
          value={text}
          placeholder={t.restricted.appealPlaceholder}
          aria-invalid={!!error || undefined}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
        {error ? (
          <span className={s.fieldError} role="alert">
            <Icon icon={AlertCircle} size={12} />
            {error}
          </span>
        ) : (
          <span className={`${s.textHint} tnum`}>{t.restricted.appealCount(text.length)}</span>
        )}
      </label>
      {!formId && (
        <div className={s.appealActions}>
          <Button type="submit" variant="primary" loading={busy}>
            {t.restricted.appealSubmit}
          </Button>
        </div>
      )}
    </form>
  )
}
