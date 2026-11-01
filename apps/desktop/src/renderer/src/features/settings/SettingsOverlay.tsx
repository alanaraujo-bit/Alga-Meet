import type { Session } from '@alga/shared'
import { Bell, ChevronsUpDown, CreditCard, Gem, Keyboard, LogOut, Mic, Minus, Monitor, Palette, Plus, Power, Shield, User, Wrench, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { HotkeyAction, UpdateStatus } from '../../../../shared/bridge'
import { media, useMedia, type ProcessingMode } from '@/media'
import { errorText, fieldErrors } from '@/lib/errors'
import { ago } from '@/lib/format'
import { changePassword, listSessions, patchMe, removeAvatar, revokeOtherSessions, revokeSession, uploadAvatar } from '@/store/actions'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { useUi, type TextSize } from '@/store/ui'
import { Avatar, Button, Icon, IconButton, Kbd, MenuButton, SegmentedControl, Spinner, Switch, TextField, toast, Tooltip } from '@/ui'
import { MIN_PASSWORD_LENGTH } from '@alga/shared'
import { StrengthMeter, strengthHint } from '../auth/PasswordStrength'
import { openVerifyEmail } from '../auth/VerifyEmail'
import { PlanSection, StreamPlanGroup } from '../billing/Plan'
import { ShopSection } from '../billing/Shop'
import { PrivacySection } from '../trust/Privacy'
import { Group, Row, SettingsFrame } from './Frame'
import { HOTKEY_ACTIONS, loadBindings, saveBindings, type SavedBinding } from './hotkeys'
import { defaultDeviceName } from './devices'
import { ImagePicker } from './ImagePicker'
import { sessionLabel } from './sessions'
import { setZoom, stepZoom, useZoom, ZOOM_STEPS } from './zoom'
import { closeSettings, openSettings, useSettings, type SettingsSection } from './store'
import { t } from './strings'
import s from './settings.module.css'

const NAV: Array<{ group: string; items: Array<{ id: SettingsSection; icon: LucideIcon }> }> = [
  {
    group: t.groups.user,
    items: [
      { id: 'account', icon: User },
      { id: 'privacy', icon: Shield },
      { id: 'plan', icon: CreditCard },
      { id: 'shop', icon: Gem },
    ],
  },
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
  return (
    <SettingsFrame
      label={t.title}
      navTitle={t.title}
      nav={NAV.map((g) => ({ group: g.group, items: g.items.map((it) => ({ ...it, label: t.nav[it.id] })) }))}
      section={section}
      onSelect={openSettings}
      onClose={closeSettings}
      closeLabel={t.close}
      wide={section === 'shop'}
    >
      {section === 'account' && <Account />}
      {section === 'privacy' && <PrivacySection />}
      {section === 'plan' && <PlanSection />}
      {section === 'shop' && <ShopSection />}
      {section === 'voice' && <Voice />}
      {section === 'hotkeys' && <Hotkeys />}
      {section === 'notifications' && <Notifications />}
      {section === 'appearance' && <Appearance />}
      {section === 'startup' && <Startup />}
      {section === 'advanced' && <Advanced />}
    </SettingsFrame>
  )
}

// ── Minha conta ────────────────────────────────────────────────

const ACCENTS = ['#2f8f8f', '#3f7fbf', '#6b6fd1', '#9a62c4', '#c25d8f', '#c9694a', '#a08a3a', '#4f9a5f']

function Account() {
  const me = useData((st) => st.me)
  const [form, setForm] = useState(() => ({ displayName: me?.displayName ?? '', username: me?.username ?? '', bio: me?.bio ?? '', accentColor: me?.accentColor ?? null }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Changing the password ends the other sessions: the list below reloads.
  const [sessionsKey, setSessionsKey] = useState(0)
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
        <form onSubmit={save}>
          <div className={s.profileFields}>
            <ImagePicker
              shape="circle"
              hasImage={!!me.avatarUrl}
              preview={<Avatar user={{ ...me, displayName: form.displayName || me.displayName, accentColor: form.accentColor }} size={80} decorative />}
              onUpload={(file, name) => uploadAvatar(file, name).then(() => toast.success(t.account.avatarSaved))}
              onRemove={() => removeAvatar().then(() => toast.success(t.account.avatarRemoved))}
            />
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
      <Group title={t.account.email}>
        <Row label={me.email} hint={me.emailVerified === false ? t.account.emailUnverified : t.account.emailVerified}>
          {me.emailVerified === false && (
            <Button size="sm" variant="primary" onClick={openVerifyEmail}>
              {t.account.verify}
            </Button>
          )}
        </Row>
      </Group>
      <PasswordForm onChanged={() => setSessionsKey((k) => k + 1)} />
      <Sessions key={sessionsKey} />
      <Group>
        <Row label={t.account.logout} hint={t.account.logoutBody}>
          <Button variant="secondary-danger" icon={LogOut} onClick={() => void useSession.getState().logout()}>
            {t.account.logout}
          </Button>
        </Row>
      </Group>
    </>
  )
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const me = useData((st) => st.me)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const personal = [me?.username ?? '', me?.email.split('@')[0] ?? '']
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_PASSWORD_LENGTH) return setErrors({ newPassword: t.account.newPasswordHint })
    setBusy(true)
    setErrors({})
    try {
      await changePassword({ currentPassword: cur, newPassword: next })
      setCur('')
      setNext('')
      toast.success(t.account.passwordChanged)
      onChanged()
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
        <TextField
          label={t.account.newPassword}
          type="password"
          autoComplete="new-password"
          value={next}
          error={errors.newPassword}
          hint={next ? strengthHint(next, personal) : t.account.newPasswordHint}
          onChange={(e) => setNext(e.target.value)}
        />
        <StrengthMeter password={next} personal={personal} />
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
const at = (iso: string) => when.format(new Date(iso))

function Sessions() {
  const [list, setList] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
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
            <Row
              key={x.id}
              label={
                <>
                  {sessionLabel(x)}
                  {x.current && <span className={s.chip}>{t.account.thisDevice}</span>}
                </>
              }
              hint={x.current ? t.account.sessionNow(at(x.createdAt)) : t.account.sessionUsed(at(x.createdAt), ago(x.lastUsedAt))}
            >
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
          <Row label={t.account.otherDevices} hint={others ? t.account.signOutOthersBody(others) : t.account.onlyThis}>
            <Button
              variant="secondary-danger"
              size="sm"
              icon={LogOut}
              disabled={!others}
              loading={signingOut}
              onClick={() => {
                setSigningOut(true)
                revokeOtherSessions()
                  .then(() => {
                    setList((l) => l?.filter((y) => y.current) ?? null)
                    toast.success(t.account.revokedOthers)
                  })
                  .catch((e: unknown) => toast.error(errorText(e)))
                  .finally(() => setSigningOut(false))
              }}
            >
              {t.account.signOutOthers}
            </Button>
          </Row>
        </>
      )}
    </Group>
  )
}

// ── Voz e vídeo ────────────────────────────────────────────────

/** The app's own menu, not the OS list: 28 px rows, a check on the one in use, and which device "system default" is. */
function DevicePicker({ kind, label, value, options, onChange }: { kind: 'audioinput' | 'audiooutput'; label: string; value: string | null; options: Array<{ deviceId: string; label: string }>; onChange: (v: string | null) => void }) {
  const [sys, setSys] = useState<string | null>(null)
  useEffect(() => {
    // The engine drops Chromium's "default" alias; only it says which device Windows picked. Re-read when the list changes.
    let live = true
    navigator.mediaDevices?.enumerateDevices().then((l) => live && setSys(defaultDeviceName(l, kind)), () => undefined)
    return () => {
      live = false
    }
  }, [options, kind])
  const current = options.find((o) => o.deviceId === value)
  const def = sys ? t.voice.systemDefaultIs(sys) : t.voice.systemDefault
  const text = current?.label ?? def
  return (
    <MenuButton
      label={label}
      items={() => [
        { label: def, checked: !current, onSelect: () => onChange(null) },
        ...(options.length ? [{ kind: 'separator' as const }] : []),
        ...options.map((o) => ({ label: o.label, checked: o.deviceId === current?.deviceId, onSelect: () => onChange(o.deviceId) })),
      ]}
    >
      <button type="button" className={s.select} aria-label={`${label}: ${text}`}>
        <span className={s.selectText}>{text}</span>
        <Icon icon={ChevronsUpDown} size={14} />
      </button>
    </MenuButton>
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
        <Row label={t.voice.input}>
          <DevicePicker kind="audioinput" label={t.voice.input} value={devices.inputId} options={devices.inputs} onChange={(v) => void media.setInputDevice(v)} />
        </Row>
        <Row label={t.voice.output}>
          <DevicePicker kind="audiooutput" label={t.voice.output} value={devices.outputId} options={devices.outputs} onChange={(v) => void media.setOutputDevice(v)} />
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

      <StreamPlanGroup />
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

const TEXT_SIZES: TextSize[] = ['14', '15', '16', '17']

function Appearance() {
  const ui = useUi(useShallow((st) => ({ density: st.density, avatars: st.compactAvatars, text: st.textSize, reduced: st.reducedMotion })))
  const set = useUi.getState().setPref
  const zoom = useZoom((st) => st.factor)
  const app = window.alga?.app
  const [trayAnim, setTrayAnim] = useState<boolean | null>(null)
  useEffect(() => {
    if (app?.getTrayAnimation) void app.getTrayAnimation().then(setTrayAnim)
  }, [app])
  return (
    <Group>
      {zoom !== null && (
        <Row label={t.appearance.zoom} hint={t.appearance.zoomHint}>
          <div className={s.stepper} role="group" aria-label={t.appearance.zoom}>
            <IconButton icon={Minus} label={t.appearance.zoomOut} shortcut="Ctrl -" disabledReason={zoom <= ZOOM_STEPS[0] ? t.appearance.zoomMin : undefined} onClick={() => setZoom(stepZoom(zoom, -1))} />
            <Tooltip content={t.appearance.zoomReset} shortcut="Ctrl 0">
              <button type="button" className={`${s.stepperValue} tnum`} aria-live="polite" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)} %
              </button>
            </Tooltip>
            <IconButton icon={Plus} label={t.appearance.zoomIn} shortcut="Ctrl =" disabledReason={zoom >= ZOOM_STEPS.at(-1)! ? t.appearance.zoomMax : undefined} onClick={() => setZoom(stepZoom(zoom, 1))} />
          </div>
        </Row>
      )}
      <Row label={t.appearance.textSize} hint={t.appearance.textSizeHint(ui.text)}>
        <SegmentedControl label={t.appearance.textSize} value={ui.text} onChange={(v) => set('textSize', v)} items={TEXT_SIZES.map((v) => ({ value: v, label: v }))} />
      </Row>
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
      {ui.density === 'compact' && (
        <Row label={t.appearance.avatars} hint={ui.avatars ? t.appearance.avatarsOn : t.appearance.avatarsOff}>
          <Switch checked={ui.avatars} label={t.appearance.avatars} onChange={(v) => set('compactAvatars', v)} />
        </Row>
      )}
      <Row label={t.appearance.reduceMotion} hint={t.appearance.reduceMotionHint}>
        <Switch checked={ui.reduced} label={t.appearance.reduceMotion} onChange={(v) => set('reducedMotion', v)} />
      </Row>
      {app?.setTrayAnimation && trayAnim !== null && (
        <Row label={t.appearance.trayAnimation} hint={t.appearance.trayAnimationHint}>
          <Switch
            checked={trayAnim}
            label={t.appearance.trayAnimation}
            onChange={(v) => void app.setTrayAnimation(v).then(() => setTrayAnim(v), (e: unknown) => toast.error(errorText(e)))}
          />
        </Row>
      )}
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
