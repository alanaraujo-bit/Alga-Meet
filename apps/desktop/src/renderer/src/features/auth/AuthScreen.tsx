import { MIN_PASSWORD_LENGTH } from '@alga/shared'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText, fieldErrors } from '@/lib/errors'
import { parseEmailToken } from '@/lib/files'
import { confirmPasswordReset, requestPasswordReset } from '@/store/actions'
import { useSession } from '@/store/session'
import { Button, Icon, TextField } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { LogoMark } from '../app/Logo'
import { StrengthMeter, strengthHint } from './PasswordStrength'
import { t } from './strings'
import s from './auth.module.css'

type Mode = 'login' | 'register' | 'forgot' | 'reset'
type Errors = Partial<Record<'login' | 'password' | 'email' | 'username' | 'displayName' | 'token', string>>

const USERNAME = /^[a-z0-9_.]{2,32}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  // Carries context between steps: the e-mail a reset link went to, or "senha trocada" back on the login.
  const [note, setNote] = useState<{ sentTo?: string; resetDone?: boolean }>({})
  const go = (m: Mode, n: typeof note = {}) => {
    setNote(n)
    setMode(m)
  }
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
          {mode === 'login' && <LoginForm resetDone={!!note.resetDone} onSwitch={() => go('register')} onForgot={() => go('forgot')} />}
          {mode === 'register' && <RegisterForm onSwitch={() => go('login')} />}
          {mode === 'forgot' && <ForgotForm onSent={(email) => go('reset', { sentTo: email })} onHaveCode={() => go('reset')} onBack={() => go('login')} />}
          {mode === 'reset' && <ResetForm sentTo={note.sentTo} onDone={() => go('login', { resetDone: true })} onResend={() => go('forgot')} onBack={() => go('login')} />}
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

function LoginForm({ resetDone, onSwitch, onForgot }: { resetDone: boolean; onSwitch: () => void; onForgot: () => void }) {
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

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const [v, setV] = useState({ email: '', displayName: '', username: '', password: '' })
  const [errors, setErrors] = useState<Errors>({})
  const { busy, error, submit } = useSubmit(
    () =>
      useSession.getState().register({
        email: v.email.trim(),
        username: v.username.trim().toLowerCase(),
        displayName: v.displayName.trim() || undefined,
        password: v.password,
      }),
    setErrors,
  )
  const field = (k: keyof typeof v) => ({
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
    setErrors(next)
    if (Object.keys(next).length === 0) void submit()
  }

  return (
    <>
      <h1 className={s.title}>{t.register.title}</h1>
      <p className={s.subtitle}>{t.register.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
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
        <TextField label={t.register.password} type="password" autoComplete="new-password" hint={v.password ? strengthHint(v.password, personal) : t.register.passwordHint} {...field('password')} />
        <StrengthMeter password={v.password} personal={personal} />
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

function ResetForm({ sentTo, onDone, onResend, onBack }: { sentTo?: string; onDone: () => void; onResend: () => void; onBack: () => void }) {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const { busy, error, submit } = useSubmit(async () => {
    await confirmPasswordReset(parseEmailToken(token), password)
    onDone()
  }, setErrors)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!parseEmailToken(token)) next.token = t.errors.token
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t.errors.passwordShort
    setErrors(next)
    if (Object.keys(next).length === 0) void submit()
  }
  return (
    <>
      <h1 className={s.title}>{t.reset.title}</h1>
      <p className={s.subtitle}>{t.reset.subtitle}</p>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        {sentTo && <FormNote text={t.reset.sent(sentTo)} />}
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
        <TextField
          label={t.reset.password}
          type="password"
          autoComplete="new-password"
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
