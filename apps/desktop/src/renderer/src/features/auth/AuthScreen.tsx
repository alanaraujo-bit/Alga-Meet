import { MIN_AGE, MIN_PASSWORD_LENGTH, ageOn } from '@alga/shared'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText, fieldErrors } from '@/lib/errors'
import { parseEmailToken } from '@/lib/files'
import { confirmPasswordReset, requestPasswordReset } from '@/store/actions'
import { useSession } from '@/store/session'
import { Button, Icon, TextField } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { useDeepLink } from '../app/deepLinks'
import { LogoMark } from '../app/Logo'
import { parseBirth } from '../trust/birthDate'
import { BirthField, birthError } from '../trust/Gate'
import { AcceptTerms, loadLegal, useLegal } from '../trust/legal'
import { longDate, t as tt } from '../trust/strings'
import { StrengthMeter, strengthHint } from './PasswordStrength'
import { t } from './strings'
import s from './auth.module.css'

type Mode = 'login' | 'register' | 'forgot' | 'reset'
type Errors = Partial<Record<'login' | 'password' | 'email' | 'username' | 'displayName' | 'token' | 'birthDate' | 'termsVersion', string>>

const USERNAME = /^[a-z0-9_.]{2,32}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  // Carries context between steps: the e-mail a reset link went to, or "senha trocada" back on the login.
  const [note, setNote] = useState<{ sentTo?: string; resetDone?: boolean }>({})
  // algameet://auth/reset-password opens the reset form with the token already in place (consumed once).
  const resetToken = useDeepLink((x) => x.resetToken)
  const [prefill, setPrefill] = useState('')
  const go = (m: Mode, n: typeof note = {}) => {
    setNote(n)
    setMode(m)
    if (m !== 'reset') setPrefill('')
  }
  useEffect(() => {
    if (!resetToken) return
    setPrefill(resetToken)
    useDeepLink.setState({ resetToken: null })
    go('reset')
  }, [resetToken])
  const invite = useDeepLink((x) => !!x.inviteCode)
  return (
    <main className={s.screen}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          className={s.card}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT_QUART } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          <div className={s.mark}>
            <LogoMark size={28} />
          </div>
          {mode === 'login' && <LoginForm resetDone={!!note.resetDone} invite={invite} onSwitch={() => go('register')} onForgot={() => go('forgot')} />}
          {mode === 'register' && <RegisterForm invite={invite} onSwitch={() => go('login')} />}
          {mode === 'forgot' && <ForgotForm onSent={(email) => go('reset', { sentTo: email })} onHaveCode={() => go('reset')} onBack={() => go('login')} />}
          {mode === 'reset' && <ResetForm key={prefill} sentTo={note.sentTo} initialToken={prefill} onDone={() => go('login', { resetDone: true })} onResend={() => go('forgot')} onBack={() => go('login')} />}
        </motion.div>
      </AnimatePresence>
      <p className={s.version}>v{window.alga?.config.version}</p>
    </main>
  )
}

function useSubmit(run: () => Promise<void>, onFields: (f: Errors) => void, unauthorized: () => string = () => t.errors.invalidCredentials) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await run()
      setBusy(false)
    } catch (e) {
      // `password` keeps the server's own words: besides length it refuses common/leaked and personal passwords.
      const f = fieldErrors(e, { email: t.errors.email, username: t.errors.username, login: t.errors.required }) as Errors
      if (e instanceof ApiRequestError && e.code === 'conflict' && !f.username) f.username = t.errors.conflict
      onFields(f)
      if (Object.keys(f).length === 0) setError(e instanceof ApiRequestError && e.code === 'unauthorized' ? unauthorized() : errorText(e))
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

function FormAlert({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className={s.alert} role="alert">
      <Icon icon={AlertCircle} size={14} />
      <span>{text}</span>
    </div>
  )
}

function FormNote({ text }: { text: string }) {
  return (
    <div className={s.success} role="status">
      <Icon icon={CheckCircle2} size={14} />
      <span>{text}</span>
    </div>
  )
}

function FormInfo({ text }: { text: string }) {
  return (
    <div className={s.info} role="status">
      <Icon icon={Info} size={14} />
      <span>{text}</span>
    </div>
  )
}

function LoginForm({ resetDone, invite, onSwitch, onForgot }: { resetDone: boolean; invite: boolean; onSwitch: () => void; onForgot: () => void }) {
  // Why we are here, once: the gateway closed with 4010, or the account was just scheduled for deletion.
  const notice = useSession((x) => x.notice)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  // E-mail login only works once the e-mail is confirmed: say so instead of a bare "incorrect".
  const { busy, error, submit } = useSubmit(
    () => useSession.getState().login({ login: login.trim(), password }),
    setErrors,
    () => (login.includes('@') ? t.errors.invalidEmailLogin : t.errors.invalidCredentials),
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!login.trim()) next.login = t.errors.required
    if (!password) next.password = t.errors.required
    setErrors(next)
    if (Object.keys(next).length === 0) void submit()
  }

  return (
    <>
      <h1 className={s.title}>{t.login.title}</h1>
      <p className={s.subtitle}>{t.login.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        {resetDone && <FormNote text={t.login.resetDone} />}
        {invite && !resetDone && <FormNote text={t.login.invite} />}
        {notice && <FormInfo text={notice.kind === 'restricted' ? tt.notice.restricted : tt.notice.deletion(longDate(notice.purgeAfter))} />}
        <TextField
          label={t.login.login}
          name="login"
          autoComplete="username"
          autoFocus
          value={login}
          error={errors.login}
          onChange={(e) => {
            setLogin(e.target.value)
            setErrors((x) => ({ ...x, login: undefined }))
          }}
        />
        <div className={s.labelRow}>
          <TextField
            label={t.login.password}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            onChange={(e) => {
              setPassword(e.target.value)
              setErrors((x) => ({ ...x, password: undefined }))
            }}
          />
          <button type="button" className={s.forgot} onClick={onForgot}>
            {t.login.forgot}
          </button>
        </div>
        <FormAlert text={error} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={s.submit}>
          {t.login.submit}
        </Button>
      </form>
      <p className={s.switch}>
        {t.login.switch}{' '}
        <button type="button" className={s.link} onClick={onSwitch}>
          {t.login.switchAction}
        </button>
      </p>
    </>
  )
}

const EMPTY = { email: '', displayName: '', username: '', password: '', birth: '' }

function RegisterForm({ invite, onSwitch }: { invite: boolean; onSwitch: () => void }) {
  const [v, setV] = useState(EMPTY)
  const [accepted, setAccepted] = useState(false)
  const [tooYoung, setTooYoung] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const { info } = useLegal()
  const { busy, error, submit } = useSubmit(
    async () => {
      const legal = info ?? (await loadLegal())
      if (!legal) throw new ApiRequestError(0, 'network', tt.legal.loadError)
      const birth = parseBirth(v.birth)
      await useSession.getState().register({
        email: v.email.trim(),
        username: v.username.trim().toLowerCase(),
        displayName: v.displayName.trim() || undefined,
        password: v.password,
        birthDate: 'iso' in birth ? birth.iso : undefined,
        termsVersion: legal.termsVersion,
      })
    },
    (f) => {
      // A newer version of the Termos went out meanwhile: fetch it and ask for the tick again.
      if (f.termsVersion) {
        setAccepted(false)
        void loadLegal()
      }
      setErrors(f)
    },
  )
  const field = (k: Exclude<keyof typeof v, 'birth'>) => ({
    name: k,
    value: v[k],
    error: errors[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setV((x) => ({ ...x, [k]: e.target.value }))
      setErrors((x) => ({ ...x, [k]: undefined }))
    },
  })
  const personal = [v.username, v.email.split('@')[0] ?? '']

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!v.email.trim()) next.email = t.errors.required
    else if (!EMAIL.test(v.email.trim())) next.email = t.errors.email
    if (!v.username.trim()) next.username = t.errors.required
    else if (!USERNAME.test(v.username.trim().toLowerCase())) next.username = t.errors.username
    if (v.password.length < MIN_PASSWORD_LENGTH) next.password = t.errors.passwordShort
    const birth = parseBirth(v.birth)
    if ('error' in birth) next.birthDate = birthError(birth) ?? undefined
    if (!accepted) next.termsVersion = tt.legal.acceptRequired
    setErrors(next)
    if (Object.keys(next).length) return
    // Under the minimum age nothing is sent: a child's birth date never leaves the machine.
    if ('iso' in birth && ageOn(birth.iso) < MIN_AGE) {
      setV(EMPTY)
      setTooYoung(true)
      return
    }
    void submit()
  }

  if (tooYoung) return <TooYoung onBack={onSwitch} />
  return (
    <>
      <h1 className={s.title}>{t.register.title}</h1>
      <p className={s.subtitle}>{t.register.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        {invite && <FormNote text={t.login.invite} />}
        <TextField label={t.register.email} type="email" autoComplete="email" autoFocus {...field('email')} />
        <TextField label={t.register.displayName} optional autoComplete="nickname" maxLength={32} hint={t.register.displayNameHint} {...field('displayName')} />
        <TextField
          label={t.register.username}
          autoComplete="username"
          maxLength={32}
          spellCheck={false}
          hint={t.register.usernameHint}
          {...field('username')}
          onChange={(e) => {
            // Usernames are lowercase on the server; show it as it will be saved.
            setV((x) => ({ ...x, username: e.target.value.toLowerCase().replace(/\s/g, '') }))
            setErrors((x) => ({ ...x, username: undefined }))
          }}
        />
        <BirthField
          value={v.birth}
          error={errors.birthDate}
          onChange={(birth) => {
            setV((x) => ({ ...x, birth }))
            setErrors((x) => ({ ...x, birthDate: undefined }))
          }}
          hint={(words) => (words ? `${words} · ${tt.signup.birthHint}` : tt.signup.birthHint)}
        />
        <TextField label={t.register.password} type="password" autoComplete="new-password" hint={v.password ? strengthHint(v.password, personal) : t.register.passwordHint} {...field('password')} />
        <StrengthMeter password={v.password} personal={personal} />
        <AcceptTerms
          checked={accepted}
          error={errors.termsVersion}
          onChange={(c) => {
            setAccepted(c)
            setErrors((x) => ({ ...x, termsVersion: undefined }))
          }}
        />
        <FormAlert text={error} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={s.submit}>
          {t.register.submit}
        </Button>
      </form>
      <p className={s.switch}>
        {t.register.switch}{' '}
        <button type="button" className={s.link} onClick={onSwitch}>
          {t.register.switchAction}
        </button>
      </p>
    </>
  )
}

/** Under 16: a calm, final answer for this attempt. No retry button, no hint about which date would pass. */
function TooYoung({ onBack }: { onBack: () => void }) {
  return (
    <>
      <h1 className={s.title}>{tt.signup.tooYoungTitle}</h1>
      <p className={s.body}>{tt.signup.tooYoungBody}</p>
      <p className={`${s.body} ${s.bodyQuiet}`}>{tt.signup.tooYoungNothingSaved}</p>
      <Button variant="secondary" size="lg" full className={s.submit} onClick={onBack}>
        {tt.signup.tooYoungBack}
      </Button>
    </>
  )
}

function ForgotForm({ onSent, onHaveCode, onBack }: { onSent: (email: string) => void; onHaveCode: () => void; onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const { busy, error, submit } = useSubmit(async () => {
    await requestPasswordReset(email.trim())
    onSent(email.trim())
  }, setErrors)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const bad = !email.trim() ? t.errors.required : !EMAIL.test(email.trim()) ? t.errors.email : undefined
    setErrors({ email: bad })
    if (!bad) void submit()
  }
  return (
    <>
      <h1 className={s.title}>{t.forgot.title}</h1>
      <p className={s.subtitle}>{t.forgot.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <TextField
          label={t.forgot.email}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          error={errors.email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors({})
          }}
        />
        <FormAlert text={error} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={s.submit}>
          {t.forgot.submit}
        </Button>
      </form>
      <p className={`${s.switch} ${s.links}`}>
        <button type="button" className={s.link} onClick={onBack}>
          {t.forgot.back}
        </button>
        <button type="button" className={s.link} onClick={onHaveCode}>
          {t.forgot.haveCode}
        </button>
      </p>
    </>
  )
}

function ResetForm({ sentTo, initialToken, onDone, onResend, onBack }: { sentTo?: string; initialToken: string; onDone: () => void; onResend: () => void; onBack: () => void }) {
  // A token from a deep link is a secret: it is used, never shown. A refusal brings the manual field back.
  const [fromLink, setFromLink] = useState(!!initialToken)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const onFields = (f: Errors) => {
    if (f.token && fromLink) setFromLink(false)
    setErrors(f)
  }
  const value = fromLink ? initialToken : parseEmailToken(token)
  const { busy, error, submit } = useSubmit(async () => {
    await confirmPasswordReset(value, password)
    onDone()
  }, onFields)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!value) next.token = t.errors.token
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t.errors.passwordShort
    setErrors(next)
    if (Object.keys(next).length === 0) void submit()
  }
  return (
    <>
      <h1 className={s.title}>{t.reset.title}</h1>
      <p className={s.subtitle}>{fromLink ? t.reset.subtitleLink : t.reset.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        {sentTo && <FormNote text={t.reset.sent(sentTo)} />}
        {fromLink ? (
          <FormNote text={t.reset.fromLink} />
        ) : (
          <TextField
            label={t.reset.token}
            placeholder={t.reset.tokenPlaceholder}
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
            value={token}
            error={errors.token}
            onChange={(e) => {
              setToken(e.target.value)
              setErrors((x) => ({ ...x, token: undefined }))
            }}
          />
        )}
        <TextField
          label={t.reset.password}
          type="password"
          autoComplete="new-password"
          autoFocus={fromLink}
          value={password}
          error={errors.password}
          hint={password ? strengthHint(password) : t.register.passwordHint}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((x) => ({ ...x, password: undefined }))
          }}
        />
        <StrengthMeter password={password} />
        <FormAlert text={error} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} className={s.submit}>
          {t.reset.submit}
        </Button>
      </form>
      <p className={`${s.switch} ${s.links}`}>
        <button type="button" className={s.link} onClick={onBack}>
          {t.forgot.back}
        </button>
        <button type="button" className={s.link} onClick={onResend}>
          {t.reset.resend}
        </button>
      </p>
    </>
  )
}
