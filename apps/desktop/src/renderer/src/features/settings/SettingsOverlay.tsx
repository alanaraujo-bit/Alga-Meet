import type { Session } from '@alga/shared'
import { Bell, Keyboard, LogOut, Mic, Monitor, Palette, Power, User, Wrench, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { HotkeyAction, UpdateStatus } from '../../../../shared/bridge'
import { media, useMedia, type ProcessingMode } from '@/media'
import { errorText, fieldErrors } from '@/lib/errors'
import { changePassword, listSessions, patchMe, revokeOtherSessions, revokeSession } from '@/store/actions'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Avatar, Button, Icon, IconButton, Kbd, SegmentedControl, Spinner, Switch, TextField, toast } from '@/ui'
import { focusables } from '@/ui/floating'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { HOTKEY_ACTIONS, loadBindings, saveBindings, type SavedBinding } from './hotkeys'
import { closeSettings, openSettings, useSettings, type SettingsSection } from './store'
import { t } from './strings'
import s from './settings.module.css'

const NAV: Array<{ group: string; items: Array<{ id: SettingsSection; icon: LucideIcon }> }> = [
  { group: t.groups.user, items: [{ id: 'account', icon: User }] },
  {
    group: t.groups.app,
    items: [
      { id: 'voice', icon: Mic },
      { id: 'hotkeys', icon: Keyboard },
      { id: 'notifications', icon: Bell },
      { id: 'appearance', icon: Palette },
      { id: 'startup', icon: Power },
      { id: 'advanced', icon: Wrench },
    ],
  },
]

/** Full-window settings (below the title bar). Esc closes; focus returns to what opened it. */
export function SettingsOverlay() {
  const section = useSettings((st) => st.section)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        if (useSettings.getState().section) closeSettings()
        else openSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(<AnimatePresence>{section && <Panel key="settings" section={section} />}</AnimatePresence>, document.body)
}

function Panel({ section }: { section: SettingsSection }) {
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Menus, popovers and modals inside close first (they stop propagation on their own Esc).
      if (e.key === 'Escape' && !document.querySelector('[role="menu"], [role="dialog"]:not([data-settings])')) {
        e.preventDefault()
        closeSettings()
      } else if (e.key === 'Tab' && root.current) {
        const f = focusables(root.current)
        const i = f.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          e.preventDefault()
          f[f.length - 1]?.focus()
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault()
          f[0]?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])
  useEffect(() => {
    // Braces matter: Chromium's scrollTo now returns a Promise, which React would take for a cleanup.
    content.current?.scrollTo({ top: 0 })
  }, [section])

  return (
    <motion.div
      ref={root}
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      data-settings
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: EASE_IN } }}
    >
      <nav className={s.nav} aria-label={t.title}>
        <div className={s.navInner}>
          <h1 className={s.navTitle}>{t.title}</h1>
          {NAV.map((g) => (
            <div key={g.group} className={s.navGroup}>
              <div className={s.navGroupLabel}>{g.group}</div>
              {g.items.map((it) => (
                <button key={it.id} type="button" className={s.navItem} aria-current={section === it.id ? 'page' : undefined} onClick={() => openSettings(it.id)}>
                  <Icon icon={it.icon} size={16} />
                  {t.nav[it.id]}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div ref={content} className={s.content}>
        <div className={s.contentInner}>
          <header className={s.header}>
            <h2 className={s.title}>{t.nav[section]}</h2>
            <span className={s.close}>
              <IconButton icon={X} label={t.close} shortcut="Esc" size="lg" onClick={closeSettings} />
              <Kbd>Esc</Kbd>
            </span>
          </header>
          {section === 'account' && <Account />}
          {section === 'voice' && <Voice />}
          {section === 'hotkeys' && <Hotkeys />}
          {section === 'notifications' && <Notifications />}
          {section === 'appearance' && <Appearance />}
          {section === 'startup' && <Startup />}
          {section === 'advanced' && <Advanced />}
        </div>
      </div>
    </motion.div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────

function Group({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.group}>
      {title && <h3 className={s.groupTitle}>{title}</h3>}
      {description && <p className={s.groupDesc}>{description}</p>}
      <div className={s.rows}>{children}</div>
    </section>
  )
}

function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className={s.rowLabel}>
            {label}
          </label>
        ) : (
          <span className={s.rowLabel}>{label}</span>
        )}
        {hint && <span className={s.rowHint}>{hint}</span>}
      </div>
      {children && <div className={s.rowControl}>{children}</div>}
    </div>
  )
}

// ── Minha conta ────────────────────────────────────────────────

const ACCENTS = ['#2f8f8f', '#3f7fbf', '#6b6fd1', '#9a62c4', '#c25d8f', '#c9694a', '#a08a3a', '#4f9a5f']

function Account() {
  const me = useData((st) => st.me)
  const [form, setForm] = useState(() => ({ displayName: me?.displayName ?? '', username: me?.username ?? '', bio: me?.bio ?? '', accentColor: me?.accentColor ?? null }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  if (!me) return null
  const dirty = form.displayName !== me.displayName || form.username !== me.username || form.bio !== me.bio || form.accentColor !== me.accentColor
  const reset = () => {
    setForm({ displayName: me.displayName, username: me.username, bio: me.bio, accentColor: me.accentColor })
    setErrors({})
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const username = form.username.trim().toLowerCase()
    if (!/^[a-z0-9_.]{2,32}$/.test(username)) return setErrors({ username: t.account.usernameError })
    setBusy(true)
    setErrors({})
    try {
      await patchMe({
        ...(form.displayName.trim() !== me.displayName && { displayName: form.displayName.trim() }),
        ...(username !== me.username && { username }),
        ...(form.bio !== me.bio && { bio: form.bio }),
        ...(form.accentColor !== me.accentColor && { accentColor: form.accentColor }),
      })
      toast.success(t.account.saved)
    } catch (err) {
      const f = fieldErrors(err, { username: t.account.usernameError })
      setErrors(f)
      if (!Object.keys(f).length) toast.error(errorText(err, t.account.saveError))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title={t.account.profile}>
        <form className={s.profile} onSubmit={save}>
          <div className={s.profilePreview}>
            <Avatar user={{ ...me, displayName: form.displayName || me.displayName, accentColor: form.accentColor }} size={64} decorative />
          </div>
          <div className={s.profileFields}>
            <TextField label={t.account.displayName} value={form.displayName} maxLength={32} error={errors.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <TextField label={t.account.username} value={form.username} maxLength={32} spellCheck={false} error={errors.username} hint={t.account.usernameHint} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <label className={s.textareaField}>
              <span className={s.fieldLabel}>{t.account.bio}</span>
              <textarea className={s.textarea} rows={3} maxLength={190} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              <span className={`${s.rowHint} tnum`}>{errors.bio ?? t.account.bioHint(form.bio.length)}</span>
            </label>
            <div className={s.textareaField}>
              <span className={s.fieldLabel}>{t.account.accent}</span>
              <div className={s.swatches} role="radiogroup" aria-label={t.account.accent}>
                <button type="button" role="radio" aria-checked={form.accentColor === null} className={`${s.swatch} ${s.swatchAuto}`} aria-label={t.account.accentNone} onClick={() => setForm({ ...form, accentColor: null })} />
                {ACCENTS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={form.accentColor === c} className={s.swatch} style={{ background: c }} aria-label={c} onClick={() => setForm({ ...form, accentColor: c })} />
                ))}
              </div>
              <span className={s.rowHint}>{t.account.accentHint}</span>
            </div>
            <div className={s.formActions}>
              {dirty && (
                <Button variant="ghost" onClick={reset}>
                  {t.account.reset}
                </Button>
              )}
              <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
                {t.account.save}
              </Button>
            </div>
          </div>
        </form>
      </Group>
      <PasswordForm />
      <Sessions />
      <Group>
        <Row label={t.account.logout} hint={t.account.logoutBody}>
          <Button variant="danger" icon={LogOut} onClick={() => void useSession.getState().logout()}>
            {t.account.logout}
          </Button>
        </Row>
      </Group>
    </>
  )
}

function PasswordForm() {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return setErrors({ newPassword: t.account.newPasswordHint })
    setBusy(true)
    setErrors({})
    try {
      await changePassword({ currentPassword: cur, newPassword: next })
      setCur('')
      setNext('')
      toast.success(t.account.passwordChanged)
    } catch (err) {
      const f = fieldErrors(err)
      setErrors(Object.keys(f).length ? f : { currentPassword: errorText(err, t.account.passwordError) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group title={t.account.password}>
      <form className={s.password} onSubmit={submit}>
        <TextField label={t.account.currentPassword} type="password" autoComplete="current-password" value={cur} error={errors.currentPassword} onChange={(e) => setCur(e.target.value)} />
        <TextField label={t.account.newPassword} type="password" autoComplete="new-password" value={next} error={errors.newPassword} hint={t.account.newPasswordHint} onChange={(e) => setNext(e.target.value)} />
        <div className={s.formActions}>
          <Button type="submit" loading={busy} disabled={!cur || !next}>
            {t.account.changePassword}
          </Button>
        </div>
      </form>
    </Group>
  )
}

const when = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** "Chrome 140 / Windows" out of a user agent, or the raw string when we can't tell. */
function deviceName(ua: string): string {
  const app = /AlgaMeet|Electron/i.test(ua) ? 'Alga Meet' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /node|undici/i.test(ua) ? 'API' : null
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null
  return [app, os].filter(Boolean).join(' · ') || ua.slice(0, 48) || 'Dispositivo desconhecido'
}

function Sessions() {
  const [list, setList] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => {
    setError(null)
    listSessions()
      .then((l) => setList(l.sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt))))
      .catch((e: unknown) => setError(errorText(e, t.account.sessionsError)))
  }
  useEffect(() => load(), [])
  const others = list?.filter((x) => !x.current).length ?? 0
  return (
    <Group title={t.account.sessions} description={t.account.sessionsBody}>
      {error ? (
        <Row label={<span className={s.error}>{error}</span>}>
          <Button size="sm" onClick={load}>
            Tentar de novo
          </Button>
        </Row>
      ) : !list ? (
        <Row label={<Spinner size={16} label="Carregando" />} />
      ) : (
        <>
          {list.map((x) => (
            <Row key={x.id} label={x.current ? `${deviceName(x.userAgent)} · ${t.account.thisDevice}` : deviceName(x.userAgent)} hint={t.account.lastUsed(when.format(new Date(x.lastUsedAt)))}>
              {!x.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void revokeSession(x.id)
                      .then(() => {
                        setList((l) => l?.filter((y) => y.id !== x.id) ?? null)
                        toast.success(t.account.revoked)
                      })
                      .catch((e: unknown) => toast.error(errorText(e)))
                  }
                >
                  {t.account.revoke}
                </Button>
              )}
            </Row>
          ))}
          {others > 1 && (
            <div className={s.formActions}>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  void revokeOtherSessions()
                    .then(() => {
                      setList((l) => l?.filter((y) => y.current) ?? null)
                      toast.success(t.account.revokedOthers)
                    })
                    .catch((e: unknown) => toast.error(errorText(e)))
                }
              >
                {t.account.revokeOthers}
              </Button>
            </div>
          )}
        </>
      )}
    </Group>
  )
}

// ── Voz e vídeo ────────────────────────────────────────────────

function DeviceSelect({ id, value, options, onChange }: { id: string; value: string | null; options: Array<{ deviceId: string; label: string }>; onChange: (v: string | null) => void }) {
  return (
    <select id={id} className={s.select} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{t.voice.systemDefault}</option>
      {options
        .filter((o) => o.deviceId && o.deviceId !== 'default' && o.deviceId !== 'communications')
        .map((o, i) => (
          <option key={o.deviceId} value={o.deviceId}>
            {o.label || `${id === 'in' ? t.voice.input : t.voice.output} ${i + 1}`}
          </option>
        ))}
    </select>
  )
}

function Voice() {
  const devices = useMedia((st) => st.devices)
  const self = useMedia(useShallow((st) => ({ processing: st.self.processing, active: st.self.processingActive, mode: st.self.inputMode, sens: st.self.sensitivityDb })))
  const test = useMedia((st) => st.micTest)
  const prefs = media.prefs.get()
  const [release, setRelease] = useState(prefs.pttReleaseMs)
  const [sounds, setSounds] = useState(prefs.sounds)
  const pttBound = loadBindings().some((b) => b.action === 'pushToTalk')

  useEffect(() => {
    void media.refreshDevices()
    return () => void media.stopMicTest()
  }, [])
  const noLabels = devices.inputs.length > 0 && devices.inputs.every((d) => !d.label)

  return (
    <>
      <Group title={t.voice.devices} description={noLabels ? t.voice.noLabels : undefined}>
        <Row label={t.voice.input} htmlFor="in">
          <DeviceSelect id="in" value={devices.inputId} options={devices.inputs} onChange={(v) => void media.setInputDevice(v)} />
        </Row>
        <Row label={t.voice.output} htmlFor="out">
          <DeviceSelect id="out" value={devices.outputId} options={devices.outputs} onChange={(v) => void media.setOutputDevice(v)} />
        </Row>
      </Group>

      <Group title={t.voice.test} description={t.voice.testBody}>
        <div className={s.meterRow}>
          <LevelMeter />
          <Button
            variant={test.active ? 'secondary' : 'primary'}
            icon={Mic}
            onClick={() => void (test.active ? media.stopMicTest() : media.startMicTest({ loopback: test.loopback }))}
          >
            {test.active ? t.voice.testStop : t.voice.testStart}
          </Button>
        </div>
        <Row label={t.voice.loopback} hint={t.voice.loopbackHint}>
          <Switch
            checked={test.loopback}
            label={t.voice.loopback}
            onChange={(v) => void (async () => {
              if (test.active) await media.stopMicTest()
              await media.startMicTest({ loopback: v })
            })()}
          />
        </Row>
      </Group>

      <Group title={t.voice.processing} description={self.processing === 'advanced' && self.active !== 'advanced' ? t.voice.processingFallback : undefined}>
        <div className={s.choices} role="radiogroup" aria-label={t.voice.processing}>
          {(['standard', 'advanced', 'off'] as ProcessingMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={self.processing === m} className={s.choice} onClick={() => void media.setProcessing(m)}>
              <span className={s.radio} aria-hidden />
              <span className={s.rowText}>
                <span className={s.rowLabel}>{t.voice.processingModes[m][0]}</span>
                <span className={s.rowHint}>{t.voice.processingModes[m][1]}</span>
              </span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={t.voice.inputMode}>
        <Row label={self.mode === 'vad' ? t.voice.vad : t.voice.ptt} hint={self.mode === 'vad' ? t.voice.vadHint : pttBound ? t.voice.pttHint : t.voice.pttUnbound}>
          <SegmentedControl
            label={t.voice.inputMode}
            value={self.mode}
            onChange={(v) => media.setInputMode(v)}
            items={[
              { value: 'vad', label: t.voice.vad },
              { value: 'ptt', label: t.voice.ptt },
            ]}
          />
        </Row>
        {self.mode === 'vad' ? (
          <>
            <Row label={t.voice.sensitivityAuto} hint={t.voice.sensitivityAutoHint}>
              <Switch checked={self.sens === null} label={t.voice.sensitivityAuto} onChange={(v) => media.setSensitivity(v ? null : useMedia.getState().self.thresholdDb)} />
            </Row>
            <div className={s.sensitivity}>
              <span className={s.rowLabel}>{t.voice.sensitivity}</span>
              <ThresholdMeter manual={self.sens !== null} />
              <span className={s.rowHint}>{t.voice.sensitivityHint}</span>
            </div>
          </>
        ) : (
          <Row label={t.voice.release} hint={t.voice.releaseHint(release)} htmlFor="release">
            <input
              id="release"
              type="range"
              className={s.range}
              min={0}
              max={1000}
              step={10}
              value={release}
              onChange={(e) => {
                const v = Number(e.target.value)
                setRelease(v)
                media.setPttReleaseDelay(v)
              }}
            />
          </Row>
        )}
      </Group>

      <Group>
        <Row label={t.voice.sounds} hint={t.voice.soundsHint}>
          <Switch
            checked={sounds}
            label={t.voice.sounds}
            onChange={(v) => {
              setSounds(v)
              media.setSoundsEnabled(v)
            }}
          />
        </Row>
      </Group>
    </>
  )
}

/** Live input level (mic test or call). Width transitions are skipped: it follows the voice, not an animation. */
function LevelMeter() {
  const level = useMedia((st) => st.self.level)
  const open = useMedia((st) => st.self.gateOpen)
  return (
    <div className={s.meter} role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <span className={`${s.meterFill} ${open ? s.meterOpen : ''}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
    </div>
  )
}

const DB_MIN = -100
const pct = (db: number) => ((Math.max(DB_MIN, Math.min(0, db)) - DB_MIN) / -DB_MIN) * 100

/** Level in dB against the gate threshold; drag the line to set it (manual mode). */
function ThresholdMeter({ manual }: { manual: boolean }) {
  const m = useMedia(useShallow((st) => ({ db: st.self.levelDb, th: st.self.sensitivityDb ?? st.self.thresholdDb, open: st.self.gateOpen })))
  return (
    <div className={s.threshold}>
      <div className={s.meter}>
        <span className={`${s.meterFill} ${m.open ? s.meterOpen : ''}`} style={{ width: `${pct(m.db)}%` }} />
        <span className={s.thresholdLine} style={{ left: `${pct(m.th)}%` }} />
      </div>
      <input
        type="range"
        className={s.thresholdRange}
        min={DB_MIN}
        max={0}
        step={1}
        value={Math.round(m.th)}
        disabled={!manual}
        aria-label={t.voice.sensitivity}
        aria-valuetext={`${Math.round(m.th)} dB`}
        onChange={(e) => media.setSensitivity(Number(e.target.value))}
      />
      <span className={`${s.rowHint} tnum`}>{Math.round(m.th)} dB</span>
    </div>
  )
}

// ── Atalhos ────────────────────────────────────────────────────

function Hotkeys() {
  const [list, setList] = useState<SavedBinding[]>(loadBindings)
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  if (!window.alga?.hotkeys) return <Group description={t.hotkeys.unavailable}>{null}</Group>
  const record = async (action: HotkeyAction) => {
    setRecording(action)
    try {
      const r = await window.alga.hotkeys.record()
      if (!r) return
      const next = [...list.filter((b) => b.action !== action), { action, keys: r.keys, mouseButtons: r.mouseButtons, label: r.label }]
      await saveBindings(next)
      setList(next)
    } catch (e) {
      toast.error(errorText(e, t.hotkeys.error))
    } finally {
      setRecording(null)
    }
  }
  const clear = async (action: HotkeyAction) => {
    const next = list.filter((b) => b.action !== action)
    await saveBindings(next).catch((e: unknown) => toast.error(errorText(e, t.hotkeys.error)))
    setList(next)
  }
  return (
    <Group description={t.hotkeys.body}>
      {HOTKEY_ACTIONS.map((a) => {
        const b = list.find((x) => x.action === a)
        return (
          <Row key={a} label={t.hotkeys.actions[a][0]} hint={t.hotkeys.actions[a][1]}>
            <span className={s.binding}>{recording === a ? <span className={s.recording}>{t.hotkeys.recording}</span> : b ? <Kbd>{b.label.replace(/ \+ /g, ' ')}</Kbd> : <span className={s.rowHint}>{t.hotkeys.none}</span>}</span>
            {b && recording !== a && <IconButton icon={X} label={t.hotkeys.clear} size="sm" onClick={() => void clear(a)} />}
            <Button size="sm" disabled={!!recording} onClick={() => void record(a)}>
              {t.hotkeys.record}
            </Button>
          </Row>
        )
      })}
    </Group>
  )
}

// ── Notificações / Aparência ───────────────────────────────────

function Notifications() {
  const ui = useUi(useShallow((st) => ({ messages: st.notifyMessages, calls: st.notifyCalls, badge: st.taskbarBadge })))
  const set = useUi.getState().setPref
  return (
    <Group>
      <Row label={t.notifications.messages} hint={t.notifications.messagesHint}>
        <Switch checked={ui.messages} label={t.notifications.messages} onChange={(v) => set('notifyMessages', v)} />
      </Row>
      <Row label={t.notifications.calls} hint={t.notifications.callsHint}>
        <Switch checked={ui.calls} label={t.notifications.calls} onChange={(v) => set('notifyCalls', v)} />
      </Row>
      <Row label={t.notifications.badge} hint={t.notifications.badgeHint}>
        <Switch checked={ui.badge} label={t.notifications.badge} onChange={(v) => set('taskbarBadge', v)} />
      </Row>
    </Group>
  )
}

function Appearance() {
  const ui = useUi(useShallow((st) => ({ density: st.density, reduced: st.reducedMotion })))
  const set = useUi.getState().setPref
  return (
    <Group>
      <Row label={t.appearance.density} hint={t.appearance.densityHint}>
        <SegmentedControl
          label={t.appearance.density}
          value={ui.density}
          onChange={(v) => set('density', v)}
          items={[
            { value: 'comfortable', label: t.appearance.comfortable },
            { value: 'compact', label: t.appearance.compact },
          ]}
        />
      </Row>
      <Row label={t.appearance.reduceMotion} hint={t.appearance.reduceMotionHint}>
        <Switch checked={ui.reduced} label={t.appearance.reduceMotion} onChange={(v) => set('reducedMotion', v)} />
      </Row>
    </Group>
  )
}

// ── Inicialização / Avançado ───────────────────────────────────

function Startup() {
  const app = window.alga?.app
  const [login, setLogin] = useState<boolean | null>(null)
  const [tray, setTray] = useState<boolean | null>(null)
  useEffect(() => {
    if (!app) return
    void app.getStartAtLogin().then(setLogin)
    void app.getCloseToTray().then(setTray)
  }, [app])
  if (!app) return <Group description={t.startup.unavailable}>{null}</Group>
  return (
    <Group>
      <Row label={t.startup.login} hint={t.startup.loginHint}>
        <Switch checked={!!login} disabled={login === null} label={t.startup.login} onChange={(v) => void app.setStartAtLogin(v).then(() => setLogin(v), (e: unknown) => toast.error(errorText(e)))} />
      </Row>
      <Row label={t.startup.tray} hint={t.startup.trayHint}>
        <Switch checked={!!tray} disabled={tray === null} label={t.startup.tray} onChange={(v) => void app.setCloseToTray(v).then(() => setTray(v), (e: unknown) => toast.error(errorText(e)))} />
      </Row>
    </Group>
  )
}

function updateText(u: UpdateStatus): string {
  const st = t.advanced.status
  switch (u.state) {
    case 'idle':
      return st.idle
    case 'checking':
      return st.checking
    case 'none':
      return st.none
    case 'available':
      return st.available(u.version)
    case 'downloading':
      return st.downloading(u.percent)
    case 'ready':
      return st.ready(u.version)
    case 'error':
      return st.error(u.message)
    case 'disabled':
      return st.disabled(u.reason)
  }
}

function Advanced() {
  const cfg = window.alga?.config
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => window.alga?.updates?.onStatus(setStatus), [])
  const check = () => {
    setStatus({ state: 'checking' })
    window.alga.updates
      .check()
      .then(setStatus)
      .catch((e: unknown) => setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) }))
  }
  return (
    <Group>
      <Row label={t.advanced.version} hint={cfg ? `${cfg.version}${cfg.isPackaged ? '' : ' (dev)'}` : undefined} />
      {cfg?.profile && cfg.profile !== 'default' && <Row label={t.advanced.profile} hint={cfg.profile} />}
      <Row label={t.advanced.updates} hint={<span role="status">{updateText(status)}</span>}>
        {status.state === 'ready' ? (
          <Button variant="primary" onClick={() => window.alga.updates.install()}>
            {t.advanced.install}
          </Button>
        ) : (
          <Button loading={status.state === 'checking'} disabled={!window.alga?.updates || status.state === 'downloading'} onClick={check}>
            {t.advanced.check}
          </Button>
        )}
      </Row>
      <Row label={t.advanced.logs} hint={t.advanced.logsHint}>
        <Button icon={Monitor} disabled={!window.alga?.app} onClick={() => void window.alga.app.openLogs()}>
          {t.advanced.openLogs}
        </Button>
      </Row>
    </Group>
  )
}
