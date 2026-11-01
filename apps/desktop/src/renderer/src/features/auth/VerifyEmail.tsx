import { MailCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { ApiRequestError } from '@/lib/api'
import { errorText, fieldErrors } from '@/lib/errors'
import { parseEmailToken } from '@/lib/files'
import { resendVerification, verifyEmail } from '@/store/actions'
import { useData } from '@/store/data'
import { Button, Icon, Modal, TextField, toast } from '@/ui'
import { t } from './strings'
import s from './auth.module.css'

/**
 * Unverified accounts (Me.emailVerified === false) can do almost everything; the server refuses invites, a second
 * owned space and DMs to non-friends with 403. The app says so calmly once (sidebar strip, account settings) and turns
 * those 403s into "confirme seu e-mail" with a way to do it, instead of a dead end.
 */
const useVerify = create<{ open: boolean }>()(() => ({ open: false }))
export const openVerifyEmail = () => useVerify.setState({ open: true })

/** The 403 came from the e-mail gate (not from roles): the viewer is unverified. */
export const needsVerification = (e: unknown) => e instanceof ApiRequestError && e.status === 403 && useData.getState().me?.emailVerified === false

/** toast.error that offers "Confirmar e-mail" when that is what is missing. */
export function toastError(e: unknown, fallback?: string): void {
  toast.error(errorText(e, fallback), needsVerification(e) ? { action: { label: t.verify.action, run: openVerifyEmail } } : undefined)
}

/** Resend cooldown survives closing the dialog (module state, this session). */
let resendUntil = 0

export function VerifyEmailDialog() {
  const open = useVerify((x) => x.open)
  const email = useData((x) => x.me?.email ?? '')
  const verified = useData((x) => x.me?.emailVerified !== false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const close = () => useVerify.setState({ open: false })

  useEffect(() => {
    if (!open) return
    setValue('')
    setError(null)
    setNote(null)
  }, [open])
  const wait = Math.max(0, Math.ceil((resendUntil - now) / 1000))
  useEffect(() => {
    if (!open || wait <= 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open, wait])
  // Verified elsewhere (link opened on another device, gateway ME_UPDATE): nothing left to do here.
  useEffect(() => {
    if (open && verified) close()
  }, [open, verified])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const token = parseEmailToken(value)
    if (!token) return setError(t.errors.token)
    setBusy(true)
    setError(null)
    try {
      await verifyEmail(token)
      toast.success(t.verify.done)
      close()
    } catch (err) {
      setError(fieldErrors(err).token ?? errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const resend = async () => {
    try {
      await resendVerification()
      resendUntil = Date.now() + 60_000
      setNote(t.verify.resent(email))
    } catch (err) {
      // 3 per 15 minutes: wait it out rather than keep failing.
      if (err instanceof ApiRequestError && err.code === 'rate_limited') resendUntil = Date.now() + 5 * 60_000
      setNote(errorText(err))
    }
    setNow(Date.now())
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t.verify.title}
      description={t.verify.body(email)}
      footer={
        <>
          <Button variant="ghost" disabled={wait > 0} onClick={() => void resend()}>
            {wait > 0 ? t.verify.resendIn(wait) : t.verify.resend}
          </Button>
          <Button type="submit" form="verify-email" variant="primary" loading={busy}>
            {t.verify.submit}
          </Button>
        </>
      }
    >
      <form id="verify-email" className={s.dialogForm} onSubmit={submit}>
        <TextField
          label={t.verify.field}
          placeholder={t.verify.placeholder}
          value={value}
          spellCheck={false}
          autoComplete="one-time-code"
          error={error}
          hint={note ?? t.verify.hint}
          autoFocus
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
        />
        <p className={s.dialogNote}>{t.verify.limits}</p>
      </form>
    </Modal>
  )
}

/** Quiet, one-row reminder in the Home sidebar while the e-mail is unconfirmed. Never a modal, never red. */
export function VerifyStrip() {
  const unverified = useData((x) => x.me?.emailVerified === false)
  if (!unverified) return null
  return (
    <button type="button" className={s.strip} onClick={openVerifyEmail}>
      <span className={s.stripIcon}>
        <Icon icon={MailCheck} size={16} />
      </span>
      <span className={s.stripText}>
        <span className={s.stripTitle}>{t.verify.stripTitle}</span>
        <span className={s.stripBody}>{t.verify.stripBody}</span>
      </span>
    </button>
  )
}
