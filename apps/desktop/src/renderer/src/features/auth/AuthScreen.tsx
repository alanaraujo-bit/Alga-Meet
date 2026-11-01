import { AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText, fieldErrors } from '@/lib/errors'
import { useSession } from '@/store/session'
import { Button, Icon, TextField } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { LogoMark } from '../app/Logo'
import { t } from './strings'
import s from './auth.module.css'

type Mode = 'login' | 'register'
type Errors = Partial<Record<'login' | 'password' | 'email' | 'username' | 'displayName', string>>

const USERNAME = /^[a-z0-9_.]{2,32}$/

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
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
          {mode === 'login' ? <LoginForm onSwitch={() => setMode('register')} /> : <RegisterForm onSwitch={() => setMode('login')} />}
        </motion.div>
      </AnimatePresence>
      <p className={s.version}>v{window.alga?.config.version}</p>
    </main>
  )
}

function useSubmit(run: () => Promise<void>, onFields: (f: Errors) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (e) {
      const f = fieldErrors(e, {
        email: t.errors.email,
        username: t.errors.username,
        password: t.errors.passwordShort,
        login: t.errors.required,
      }) as Errors
      onFields(f)
      if (Object.keys(f).length === 0) {
        setError(
          e instanceof ApiRequestError && e.code === 'unauthorized' ? t.errors.invalidCredentials
          : e instanceof ApiRequestError && e.code === 'conflict' ? t.errors.conflict
          : errorText(e),
        )
      }
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

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const { busy, error, submit } = useSubmit(() => useSession.getState().login({ login: login.trim(), password }), setErrors)

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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    if (!v.email.trim()) next.email = t.errors.required
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) next.email = t.errors.email
    if (!v.username.trim()) next.username = t.errors.required
    else if (!USERNAME.test(v.username.trim().toLowerCase())) next.username = t.errors.username
    if (v.password.length < 8) next.password = t.errors.passwordShort
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
        <TextField label={t.register.password} type="password" autoComplete="new-password" hint={t.register.passwordHint} {...field('password')} />
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
