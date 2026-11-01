import { EXPORT_DOWNLOAD_TTL_MINUTES, type AccountAction, type AccountDeletionScheduled, type AppealView, type DataExport, type DataExportDownload } from '@alga/shared'
import { AlertCircle, Ban, CheckCircle2, Clock, Download, EyeOff, Info, PauseCircle, RotateCcw, ShieldCheck, Trash2, UserX, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { patchMe } from '@/store/actions'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { Button, Icon, Modal, Spinner, Switch, TextField } from '@/ui'
import { t as ta } from '../auth/strings'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { Group, Row } from '../settings/Frame'
import { closeSettings } from '../settings/store'
import { LegalDocs, useLegal } from './legal'
import { AppealForm } from './Restricted'
import { RULE, cap, longDate, longDateTime, t } from './strings'
import st from '../settings/settings.module.css'
import s from './trust.module.css'

/** Configurações › Privacidade: protections, account actions, the legal texts, a copy of your data, deleting the account. */
export function PrivacySection() {
  const teen = useData((x) => x.me?.ageBracket === 'teen')
  const { info } = useLegal()
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      {teen && <TeenProtections />}
      <ActionsGroup />
      <Group title={t.privacy.docsTitle} description={t.privacy.docsBody}>
        {info ? <LegalDocs info={info} /> : <Row label={<Spinner size={16} label="Carregando" />} />}
      </Group>
      <TelemetryGroup />
      <ExportGroup />
      <Group title={t.privacy.deleteTitle} description={t.privacy.deleteBody}>
        <Row label={t.privacy.deleteRow} hint={t.privacy.deleteHint}>
          <Button variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>
            {t.privacy.deleteOpen}
          </Button>
        </Row>
      </Group>
      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}

function TeenProtections() {
  return (
    <Group title={t.privacy.teenTitle} description={t.privacy.teenBody}>
      <Row label={<IconLabel icon={UserX} text={t.privacy.teenDm} />} hint={t.privacy.teenDmHint} />
      <Row label={<IconLabel icon={ShieldCheck} text={t.privacy.teenBuy} />} hint={t.privacy.teenBuyHint} />
    </Group>
  )
}

function IconLabel({ icon, text, quiet }: { icon: LucideIcon; text: string; quiet?: boolean }) {
  return (
    <span className={`${s.iconLabel} ${quiet ? s.iconQuiet : ''}`}>
      <Icon icon={icon} size={14} />
      {text}
    </span>
  )
}

/** Shop and plan for 16–17: the explanation takes the buy button's place (the server refuses the checkout anyway). */
export function TeenPurchaseNotice() {
  return (
    <div className={s.teenBuy} role="note">
      <Icon icon={ShieldCheck} size={16} />
      <div>
        <p className={s.teenBuyTitle}>{t.teen.buyTitle}</p>
        <p className={s.teenBuyBody}>{t.teen.buyBody}</p>
      </div>
    </div>
  )
}
export const useIsTeen = () => useData((x) => x.me?.ageBracket === 'teen')

// ── Ações na minha conta ───────────────────────────────────────

function ActionsGroup() {
  const [list, setList] = useState<AccountAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appealing, setAppealing] = useState<AccountAction | null>(null)
  const [sending, setSending] = useState(false)
  const load = () => {
    setError(null)
    api<AccountAction[]>('GET', '/users/@me/actions').then(setList, (e: unknown) => setError(errorText(e, t.privacy.actionsError)))
  }
  useEffect(load, [])
  return (
    <Group title={t.privacy.actionsTitle} description={t.privacy.actionsBody}>
      {error ? (
        <Row label={<span className={st.error}>{error}</span>}>
          <Button size="sm" onClick={load}>
            {t.legal.retry}
          </Button>
        </Row>
      ) : !list ? (
        <Row label={<Spinner size={16} label="Carregando" />} />
      ) : list.length === 0 ? (
        <Row label={<IconLabel icon={CheckCircle2} text={t.privacy.actionsEmpty} />} />
      ) : (
        list.map((x) => (
          <Row key={x.id} label={<IconLabel icon={ACTION_ICON[x.type]} text={actionLabel(x)} quiet />} hint={<span className={s.indented}>{actionHint(x)}</span>}>
            {x.appealDeadline && !x.appeal && (
              <Button size="sm" onClick={() => setAppealing(x)}>
                {t.privacy.appeal}
              </Button>
            )}
            {x.appeal && <AppealChip status={x.appeal.status} />}
          </Row>
        ))
      )}
      <Modal
        open={!!appealing}
        onClose={() => setAppealing(null)}
        title={t.privacy.appealTitle}
        description={appealing ? `${actionLabel(appealing)} · ${cap(RULE[appealing.reason])} · ${longDate(appealing.createdAt)}` : undefined}
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAppealing(null)}>
              {t.report.cancel}
            </Button>
            <Button type="submit" form="appeal-form" variant="primary" loading={sending}>
              {t.restricted.appealSubmit}
            </Button>
          </>
        }
      >
        {appealing && (
          <AppealForm
            formId="appeal-form"
            title={false}
            onBusy={setSending}
            body={appealing.appealDeadline ? t.restricted.appealBody(longDate(appealing.appealDeadline)) : undefined}
            send={(message) => api<AppealView>('POST', '/appeals', { actionId: appealing.id, message })}
            onSent={() => {
              setAppealing(null)
              load()
            }}
            onAlready={() => {
              setAppealing(null)
              load()
            }}
          />
        )}
      </Modal>
    </Group>
  )
}

const ACTION_ICON: Record<AccountAction['type'], LucideIcon> = { warn: Info, suspend: PauseCircle, ban: Ban, lift: RotateCcw }

const actionLabel = (x: AccountAction) =>
  x.type === 'suspend' && x.until ? `${t.privacy.action.suspend} ${t.privacy.untilLine(longDate(x.until))}` : t.privacy.action[x.type]

function actionHint(x: AccountAction): string {
  const when = longDate(x.createdAt)
  const base = x.type === 'lift' ? t.privacy.liftLine(when) : `${cap(RULE[x.reason])} · ${when}`
  return x.appealDeadline && !x.appeal ? `${base} · ${t.privacy.appealBy(longDate(x.appealDeadline))}` : base
}

function AppealChip({ status }: { status: AppealView['status'] }) {
  return (
    <span className={`${s.chip} ${status === 'upheld' ? s.chipOk : ''}`}>
      <Icon icon={status === 'open' ? Clock : status === 'upheld' ? CheckCircle2 : AlertCircle} size={12} />
      {t.privacy.appealStatus[status]}
    </span>
  )
}

// ── Relatório de qualidade de chamada (docs/legal/politica-de-privacidade.md: opcional, desligado por padrão) ──

function TelemetryGroup() {
  const on = useData((x) => x.me?.telemetryOptIn === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = async (telemetryOptIn: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await patchMe({ telemetryOptIn })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group title={t.privacy.telemetryTitle} description={t.privacy.telemetryBody}>
      <Row
        label={t.privacy.telemetryRow}
        hint={
          error ? (
            <span className={st.error} role="alert">
              {error}
            </span>
          ) : on ? (
            t.privacy.telemetryOn
          ) : (
            t.privacy.telemetryOff
          )
        }
      >
        <Switch checked={on} label={t.privacy.telemetryRow} disabled={busy} onChange={(v) => void set(v)} />
      </Row>
      <div className={s.disclosure}>
        <div className={s.disclosureCol}>
          <span className={s.disclosureHead}>
            <Icon icon={CheckCircle2} size={14} />
            {t.privacy.telemetrySentTitle}
          </span>
          <p>{t.privacy.telemetrySent}</p>
        </div>
        <div className={s.disclosureCol}>
          <span className={`${s.disclosureHead} ${s.disclosureNever}`}>
            <Icon icon={EyeOff} size={14} />
            {t.privacy.telemetryNeverTitle}
          </span>
          <p>{t.privacy.telemetryNever}</p>
        </div>
        <p className={s.disclosureFoot}>{t.privacy.telemetryKept}</p>
      </div>
    </Group>
  )
}

// ── Exportação ─────────────────────────────────────────────────

/** While a copy is being built: its status has no gateway event, so this page asks again now and then. */
const EXPORT_POLL_MS = 15_000

function ExportGroup() {
  const me = useData((x) => x.me)
  const [list, setList] = useState<DataExport[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<{ text: string; gated?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<DataExport | null>(null)
  const [opened, setOpened] = useState(false)
  const load = useCallback(() => {
    api<DataExport[]>('GET', '/users/@me/exports').then(
      (l) => {
        setList(l)
        setLoadError(null)
      },
      (e: unknown) => setLoadError(errorText(e, t.privacy.exportLoadError)),
    )
  }, [])
  const last = list?.[0] ?? null
  const building = last?.status === 'queued' || last?.status === 'processing'
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  useEffect(() => {
    if (!building) return
    const id = setInterval(load, EXPORT_POLL_MS)
    return () => clearInterval(id)
  }, [building, load])
  if (!me) return null
  const unverified = me.emailVerified === false
  const request = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('POST', '/users/@me/export')
      load()
    } catch (e) {
      // 429 carries the useful sentence (once a day, the link goes to the e-mail): keep the server's words.
      setError({ text: e instanceof ApiRequestError && e.code === 'rate_limited' ? e.message : errorText(e), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  const status = (x: DataExport) =>
    x.status === 'ready' ? (
      <span className={s.okLine} role="status">
        <Icon icon={CheckCircle2} size={12} />
        {opened ? t.privacy.exportOpened : t.privacy.exportReady(longDate(x.expiresAt ?? x.createdAt))}
      </span>
    ) : x.status === 'queued' || x.status === 'processing' ? (
      <span className={s.iconLabel} role="status">
        <Spinner size={12} />
        {t.privacy.exportBuilding(longDateTime(x.createdAt))}
      </span>
    ) : x.status === 'expired' ? (
      t.privacy.exportExpired(longDate(x.expiresAt ?? x.createdAt))
    ) : (
      t.privacy.exportFailed
    )
  return (
    <Group title={t.privacy.exportTitle} description={t.privacy.exportBody}>
      <Row
        label={t.privacy.exportRow}
        hint={
          unverified ? (
            t.privacy.exportVerify
          ) : error ? (
            <span className={st.error} role="alert">
              {error.text}
            </span>
          ) : loadError ? (
            <span className={st.error}>{loadError}</span>
          ) : last ? (
            status(last)
          ) : (
            t.privacy.exportHint
          )
        }
      >
        {unverified || error?.gated ? (
          <Button variant="primary" onClick={openVerifyEmail}>
            {ta.verify.action}
          </Button>
        ) : last?.status === 'ready' ? (
          <Button variant="primary" icon={Download} onClick={() => setDownloading(last)}>
            {t.privacy.exportDownload}
          </Button>
        ) : (
          <Button icon={Download} loading={busy} disabled={!list || building} onClick={() => void request()}>
            {t.privacy.exportRequest}
          </Button>
        )}
      </Row>
      <ExportDownloadDialog
        item={downloading}
        onClose={() => setDownloading(null)}
        onGone={() => {
          setDownloading(null)
          load()
        }}
        onOpened={() => {
          setDownloading(null)
          setOpened(true)
        }}
      />
    </Group>
  )
}

/** The password again (a stolen session alone cannot take the data out), then the short-lived link opens in the browser. */
function ExportDownloadDialog({ item, onClose, onGone, onOpened }: { item: DataExport | null; onClose: () => void; onGone: () => void; onOpened: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setPassword('')
    setError(null)
  }, [item])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!item) return
    if (!password) return setError(t.deletion.required)
    setBusy(true)
    setError(null)
    try {
      const r = await api<DataExportDownload>('POST', `/users/@me/exports/${item.id}/download`, { password })
      await window.alga.app.openExternal(r.downloadUrl)
      onOpened()
    } catch (err) {
      // 404/409: the copy expired or is not ready any more; the list says what is true now.
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 409)) return onGone()
      setError(err instanceof ApiRequestError && err.fields?.password ? err.fields.password : errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={t.privacy.exportDownloadTitle}
      description={t.privacy.exportDownloadBody(EXPORT_DOWNLOAD_TTL_MINUTES)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.report.cancel}
          </Button>
          <Button type="submit" form="export-download" variant="primary" icon={Download} loading={busy}>
            {t.privacy.exportDownloadConfirm}
          </Button>
        </>
      }
    >
      <form id="export-download" onSubmit={submit} noValidate>
        <TextField
          label={t.deletion.password}
          type="password"
          autoComplete="current-password"
          data-autofocus
          value={password}
          error={error}
          onChange={(ev) => {
            setPassword(ev.target.value)
            setError(null)
          }}
        />
      </form>
    </Modal>
  )
}

// ── Exclusão ───────────────────────────────────────────────────

/** Password re-check, the 7-day grace with its date, what happens to messages and owned spaces. Also opened from the terms gate. */
export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.deletion.title}
      description={t.deletion.grace(longDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()))}
      width={520}
      footer={
        <>
          <Button variant="ghost" data-autofocus onClick={onClose}>
            {t.deletion.cancel}
          </Button>
          <Button type="submit" form="delete-account" variant="danger" loading={busy}>
            {t.deletion.confirm}
          </Button>
        </>
      }
    >
      <DeleteForm setBusy={setBusy} />
    </Modal>
  )
}

function DeleteForm({ setBusy }: { setBusy: (b: boolean) => void }) {
  const meId = useData((x) => x.me?.id)
  const spaces = useData((x) => x.spaces)
  const members = useData((x) => x.members)
  const [messages, setMessages] = useState<'anonymize' | 'delete'>('anonymize')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const owned = Object.values(spaces).filter((sp) => sp.ownerId === meId)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError(t.deletion.required)
    setBusy(true)
    setError(null)
    try {
      const r = await api<AccountDeletionScheduled>('DELETE', '/users/@me', { password, messages })
      closeSettings()
      // Every session was revoked (4004): the login screen says when the purge happens and how to undo it.
      await useSession.getState().signOutWith({ kind: 'deletion', purgeAfter: r.purgeAfter })
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiRequestError && err.fields?.password ? err.fields.password : errorText(err))
    }
  }
  return (
    <form id="delete-account" className={s.deleteForm} onSubmit={submit} noValidate>
      <fieldset className={s.fieldset}>
        <legend className={s.textLabel}>{t.deletion.messages}</legend>
        {(
          [
            ['anonymize', t.deletion.anonymize],
            ['delete', t.deletion.remove],
          ] as const
        ).map(([value, [label, hint]]) => (
          <label key={value} className={s.option}>
            <input type="radio" name="messages" value={value} checked={messages === value} onChange={() => setMessages(value)} />
            <span className={s.optionText}>
              <span className={s.optionLabel}>{label}</span>
              <span className={s.optionHint}>{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {owned.length > 0 && (
        <div className={s.block}>
          <span className={s.textLabel}>{t.deletion.spacesTitle}</span>
          <ul className={s.spaces}>
            {owned.map((sp) => (
              <li key={sp.id}>
                <span className={s.spaceName}>{sp.name}</span> {Object.keys(members[sp.id] ?? {}).length > 1 ? t.deletion.spaceHeir : t.deletion.spaceDeleted}
              </li>
            ))}
          </ul>
          <span className={s.optionHint}>{t.deletion.spacesNote}</span>
        </div>
      )}
      <ul className={s.facts2}>
        <li>{t.deletion.gone}</li>
        <li>{t.deletion.kept}</li>
        <li>{t.deletion.plus}</li>
        <li>{t.deletion.exportFirst}</li>
      </ul>
      <TextField
        label={t.deletion.password}
        type="password"
        autoComplete="current-password"
        hint={t.deletion.passwordHint}
        value={password}
        error={error}
        onChange={(e) => {
          setPassword(e.target.value)
          setError(null)
        }}
      />
    </form>
  )
}
