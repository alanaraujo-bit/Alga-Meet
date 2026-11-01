import type { Me } from '@alga/shared'
import { AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiRequestError } from '@/lib/api'
import { errorText, fieldErrors } from '@/lib/errors'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { Button, Icon, TextField, toast } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { LogoMark } from '../app/Logo'
import { birthInWords, maskBirth, parseBirth, type BirthResult } from './birthDate'
import { AcceptTerms, LegalDocs, loadLegal, useLegal, versionLabel } from './legal'
import { DeleteAccountDialog } from './Privacy'
import { t } from './strings'
import a from '../auth/auth.module.css'
import s from './trust.module.css'

/** Asked once, before the shell: the legal bundle changed (accept again), or the account predates the age gate. */
export const needsGate = (me: Me | null) => !!me && (me.needsTermsAcceptance === true || me.ageBracket === 'unknown')

/** This login canceled a pending deletion (AuthResponse.deletionCanceled): say so once, in the shell. */
export function useDeletionCanceledNotice() {
  const canceled = useSession((x) => x.deletionCanceled)
  useEffect(() => {
    if (!canceled) return
    useSession.setState({ deletionCanceled: false })
    toast.success(t.notice.deletionCanceled, { description: t.notice.deletionCanceledBody })
  }, [canceled])
}

const applyMe = (me: Me) => useData.getState().apply({ t: 'ME_UPDATE', d: me })

export function AccountGate() {
  const step = useData((st) => (st.me?.needsTermsAcceptance ? 'terms' : 'birth'))
  return (
    <main className={a.screen}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className={a.card}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT_QUART } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          <div className={a.mark}>
            <LogoMark size={28} />
          </div>
          {step === 'terms' ? <TermsStep /> : <BirthStep />}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}

function Alert({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className={a.alert} role="alert">
      <Icon icon={AlertCircle} size={14} />
      <span>{text}</span>
    </div>
  )
}

function TermsStep() {
  const { info } = useLegal()
  const [accepted, setAccepted] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!accepted) return setCheckError(t.legal.acceptRequired)
    const legal = info ?? (await loadLegal())
    if (!legal) return
    setBusy(true)
    setError(null)
    try {
      applyMe(await api<Me>('POST', '/users/@me/accept-terms', { termsVersion: legal.termsVersion }))
    } catch (err) {
      // A newer version was published meanwhile: show it and ask again.
      const f = fieldErrors(err)
      if (f.termsVersion) {
        setAccepted(false)
        void loadLegal()
      }
      setError(f.termsVersion ?? errorText(err))
      setBusy(false)
    }
  }
  return (
    <>
      <h1 className={a.title}>{t.gate.termsTitle}</h1>
      <p className={a.subtitle}>{t.gate.termsBody(info ? versionLabel(info.termsVersion) : '…')}</p>
      <form className={a.form} onSubmit={submit} noValidate>
        {info && <LegalDocs info={info} />}
        <AcceptTerms
          links={!info}
          checked={accepted}
          error={checkError}
          onChange={(v) => {
            setAccepted(v)
            setCheckError(null)
          }}
        />
        <Alert text={error} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={a.submit}>
          {t.gate.termsSubmit}
        </Button>
      </form>
      <p className={a.switch}>
        {t.gate.disagree}{' '}
        <button type="button" className={a.link} onClick={() => void useSession.getState().logout()}>
          {t.gate.signOutLower}
        </button>{' '}
        {t.gate.disagreeOr}{' '}
        <button type="button" className={a.link} onClick={() => setDeleting(true)}>
          {t.gate.deleteAccount}
        </button>
        .
      </p>
      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}

const BIRTH_ERROR = { required: t.signup.birthRequired, invalid: t.signup.birthInvalid, future: t.signup.birthFuture } as const
export const birthError = (r: BirthResult) => ('error' in r ? BIRTH_ERROR[r.error] : null)

/** DD/MM/AAAA typed as digits (slashes come by themselves), read back in words. No default, no year picker nudging. */
export function BirthField({ value, onChange, error, hint, autoFocus }: { value: string; onChange: (v: string) => void; error?: string | null; hint: (words: string | null) => string; autoFocus?: boolean }) {
  const parsed = parseBirth(value)
  return (
    <TextField
      label={t.signup.birth}
      name="birthDate"
      inputMode="numeric"
      autoComplete="bday"
      placeholder={t.signup.birthPlaceholder}
      maxLength={10}
      autoFocus={autoFocus}
      value={value}
      error={error}
      hint={hint('iso' in parsed ? birthInWords(parsed.iso) : null)}
      onChange={(e) => onChange(maskBirth(e.target.value))}
    />
  )
}

function BirthStep() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseBirth(value)
    if ('error' in parsed) return setError(birthError(parsed))
    setBusy(true)
    setError(null)
    try {
      applyMe(await api<Me>('PATCH', '/users/@me/birth-date', { birthDate: parsed.iso }))
    } catch (err) {
      setBusy(false)
      // Under the minimum age the server suspends the account at once and hands back the appeal token.
      if (err instanceof ApiRequestError && err.restriction) return void useSession.getState().signOutWith(null, err.restriction)
      // Already declared (another device): just pick up the current Me.
      if (err instanceof ApiRequestError && err.status === 409) return void api<Me>('GET', '/users/@me').then(applyMe, () => setError(errorText(err)))
      setError(fieldErrors(err).birthDate ?? errorText(err))
    }
  }
  return (
    <>
      <h1 className={a.title}>{t.gate.birthTitle}</h1>
      <p className={a.subtitle}>{t.gate.birthBody}</p>
      <form className={a.form} onSubmit={submit} noValidate>
        <BirthField
          value={value}
          autoFocus
          error={error}
          onChange={(v) => {
            setValue(v)
            setError(null)
          }}
          hint={(words) => (words ? t.gate.birthConfirm(words) : t.gate.birthWhy)}
        />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={a.submit}>
          {t.gate.birthSubmit}
        </Button>
      </form>
      <p className={`${a.switch} ${s.quiet}`}>
        <button type="button" className={a.link} onClick={() => void useSession.getState().logout()}>
          {t.gate.signOut}
        </button>
      </p>
    </>
  )
}
