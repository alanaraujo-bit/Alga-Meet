import type { Invite } from '@alga/shared'
import { Check, Copy, Hash, Users, Volume2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiRequestError } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { errorText, fieldErrors } from '@/lib/errors'
import { inviteLink, parseInviteCode } from '@/lib/invite'
import { createChannel, createInvite, createSpace, joinInvite, leaveSpace, previewInvite } from '@/store/actions'
import { useData } from '@/store/data'
import { useUi, type ModalState } from '@/store/ui'
import { Button, Icon, Modal, SegmentedControl, Spinner, TextField, toast } from '@/ui'
import { initials } from '@/ui/Avatar'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { t as ta } from '../auth/strings'
import { finishOnboarding } from '../onboarding/Onboarding'
import { t as ts } from '../shell/strings'
import { t } from './strings'
import s from './spaces.module.css'

/** Renders whichever space modal the UI store points at. Keeps the last one mounted while it animates out. */
export function SpaceModals() {
  const modal = useUi((st) => st.modal)
  const [last, setLast] = useState<ModalState>(modal)
  useEffect(() => {
    if (modal) setLast(modal)
  }, [modal])
  const m = modal ?? last
  const close = () => useUi.getState().openModal(null)
  const open = (k: NonNullable<ModalState>['kind']) => modal?.kind === k
  return (
    <>
      <CreateSpaceModal open={open('createSpace')} onClose={close} />
      <JoinSpaceModal open={open('joinSpace')} onClose={close} initial={m?.kind === 'joinSpace' ? m.code : undefined} />
      {m?.kind === 'createChannel' && <CreateChannelModal open={open('createChannel')} onClose={close} spaceId={m.spaceId} initialType={m.type} />}
      {m?.kind === 'invite' && <InviteModal open={open('invite')} onClose={close} spaceId={m.spaceId} />}
      {m?.kind === 'leaveSpace' && <LeaveSpaceModal open={open('leaveSpace')} onClose={close} spaceId={m.spaceId} />}
    </>
  )
}

function CreateSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useData((st) => st.me)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gated, setGated] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setGated(false)
    }
  }, [open])
  const fallback = t.create.placeholder(me?.displayName ?? 'você')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const sp = await createSpace(name.trim() || fallback)
      finishOnboarding()
      onClose()
      const first = sp.channels.find((c) => c.type === 'text')
      useUi.getState().go({ kind: 'space', spaceId: sp.id, channelId: first?.id ?? null })
      toast.success(t.create.created(sp.name), { action: { label: ts.space.invite, run: () => useUi.getState().openModal({ kind: 'invite', spaceId: sp.id }) } })
    } catch (err) {
      setGated(needsVerification(err))
      setError(fieldErrors(err).name ?? errorText(err, t.error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.create.title}
      description={t.create.description}
      footer={
        <>
          <span className={s.footerHint}>
            {t.create.haveInvite}{' '}
            <button type="button" className={s.link} onClick={() => useUi.getState().openModal({ kind: 'joinSpace' })}>
              {t.create.haveInviteAction}
            </button>
          </span>
          <Button type="submit" form="create-space" variant="primary" loading={busy}>
            {t.create.submit}
          </Button>
        </>
      }
    >
      <form id="create-space" onSubmit={submit} className={s.createSpace}>
        <span className={s.spacePreview} aria-hidden>
          {initials(name.trim() || fallback)}
        </span>
        <div style={{ flex: 1 }}>
          <TextField label={t.create.name} value={name} placeholder={fallback} maxLength={100} error={error} onChange={(e) => setName(e.target.value)} autoFocus />
          {gated && (
            <Button size="sm" variant="secondary" className={s.verifyBtn} onClick={openVerifyEmail}>
              {ta.verify.action}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

function JoinSpaceModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: string }) {
  const [value, setValue] = useState(initial ?? '')
  const [preview, setPreview] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; invite?: Invite; error?: string }>({ state: 'idle' })
  const [busy, setBusy] = useState(false)
  const spaces = useData((st) => st.spaces)
  const users = useData((st) => st.users)
  const code = parseInviteCode(value)

  useEffect(() => {
    if (open) {
      setValue(initial ?? '')
      setPreview({ state: 'idle' })
    }
  }, [open, initial])

  // Preview before joining: debounced lookup as the user pastes/types.
  useEffect(() => {
    if (!open || !code) return setPreview({ state: 'idle' })
    setPreview({ state: 'loading' })
    let live = true
    const id = setTimeout(() => {
      previewInvite(code).then(
        (invite) => live && setPreview({ state: 'ok', invite }),
        (e: unknown) =>
          live && setPreview({ state: 'error', error: e instanceof ApiRequestError && e.code === 'not_found' ? t.join.notFound : errorText(e, t.join.notFound) }),
      )
    }, 300)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [code, open])

  const inv = preview.state === 'ok' ? preview.invite! : null
  const already = !!(inv && spaces[inv.space.id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!inv) return
    if (already) {
      onClose()
      return useUi.getState().go({ kind: 'space', spaceId: inv.space.id, channelId: null })
    }
    setBusy(true)
    try {
      const sp = await joinInvite(inv.code)
      finishOnboarding()
      onClose()
      useUi.getState().go({ kind: 'space', spaceId: sp.id, channelId: sp.channels.find((c) => c.type === 'text')?.id ?? null })
      toast.success(t.join.joined(sp.name))
    } catch (err) {
      setPreview({ state: 'error', error: errorText(err, t.join.notFound) })
    } finally {
      setBusy(false)
    }
  }

  const fieldError = value.trim() && !code ? t.join.invalid : preview.state === 'error' ? preview.error : null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.join.title}
      description={t.join.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" form="join-space" variant="primary" loading={busy} disabled={!inv}>
            {already ? t.join.open : t.join.submit}
          </Button>
        </>
      }
    >
      <form id="join-space" onSubmit={submit} className={s.stack}>
        <TextField label={t.join.label} placeholder={t.join.placeholder} value={value} spellCheck={false} autoFocus error={fieldError} onChange={(e) => setValue(e.target.value)} />
        <div className={s.preview} aria-live="polite">
          {preview.state === 'loading' && (
            <span className={s.previewHint}>
              <Spinner size={16} /> {t.join.looking}
            </span>
          )}
          {inv && (
            <div className={s.inviteCard}>
              <span className={s.spacePreview}>{inv.space.iconUrl ? <img src={inv.space.iconUrl} alt="" /> : initials(inv.space.name)}</span>
              <div className={s.inviteText}>
                <strong>{inv.space.name}</strong>
                <span>
                  <Icon icon={Users} size={12} /> {t.join.members(inv.memberCount)}
                  {users[inv.inviterId] && <> · {t.join.invitedBy(users[inv.inviterId]!.displayName)}</>}
                </span>
                {already && <span className={s.already}>{t.join.already}</span>}
              </div>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 100)

function CreateChannelModal({ open, onClose, spaceId, initialType }: { open: boolean; onClose: () => void; spaceId: string; initialType: 'text' | 'voice' }) {
  const space = useData((st) => st.spaces[spaceId])
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setType(initialType)
      setName('')
      setError(null)
    }
  }, [open, initialType])
  // Text channels are #slugs (easy to mention); voice channels keep the name as typed.
  const final = type === 'text' ? slugify(name) : name.trim()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!final) return
    setBusy(true)
    setError(null)
    try {
      const ch = await createChannel(spaceId, { type, name: final })
      onClose()
      useUi.getState().go({ kind: 'space', spaceId, channelId: ch.id })
    } catch (err) {
      setError(fieldErrors(err).name ?? errorText(err, t.error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.channel.title}
      description={space ? t.channel.description(space.name) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" form="create-channel" variant="primary" loading={busy} disabled={!final}>
            {t.channel.submit}
          </Button>
        </>
      }
    >
      <form id="create-channel" onSubmit={submit} className={s.stack}>
        <div className={s.typeCards} role="radiogroup" aria-label={t.channel.type}>
          {(['text', 'voice'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} className={s.typeCard} onClick={() => setType(k)}>
              <span className={s.typeIcon}>
                <Icon icon={k === 'text' ? Hash : Volume2} size={18} />
              </span>
              <span>
                <strong>{k === 'text' ? t.channel.text : t.channel.voice}</strong>
                <span className={s.typeBody}>{k === 'text' ? t.channel.textBody : t.channel.voiceBody}</span>
              </span>
              <span className={s.radio} aria-hidden />
            </button>
          ))}
        </div>
        <TextField
          label={t.channel.name}
          leadingIcon={type === 'text' ? Hash : Volume2}
          placeholder={type === 'text' ? t.channel.textPlaceholder : t.channel.voicePlaceholder}
          value={type === 'text' ? name.toLowerCase().replace(/\s/g, '-') : name}
          maxLength={100}
          error={error}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  )
}

const EXPIRY = { h1: 3600, d1: 86400, d7: 604800, never: 0 } as const
type Expiry = keyof typeof EXPIRY

function InviteModal({ open, onClose, spaceId }: { open: boolean; onClose: () => void; spaceId: string }) {
  const space = useData((st) => st.spaces[spaceId])
  const [expiry, setExpiry] = useState<Expiry>('d7')
  const [state, setState] = useState<{ invite?: Invite; error?: string; gated?: boolean; loading: boolean }>({ loading: true })
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let live = true
    setState({ loading: true })
    createInvite(spaceId, EXPIRY[expiry]).then(
      (invite) => live && setState({ invite, loading: false }),
      (e: unknown) => live && setState({ error: errorText(e, t.invite.error), gated: needsVerification(e), loading: false }),
    )
    return () => {
      live = false
    }
  }, [open, spaceId, expiry, attempt])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const link = state.invite ? inviteLink(state.invite.code) : ''
  return (
    <Modal open={open} onClose={onClose} title={t.invite.title(space?.name ?? '')} description={t.invite.description} width={480}>
      <TextField
        label={t.invite.link}
        readOnly
        value={state.loading ? t.invite.generating : link}
        error={state.error}
        onFocus={(e) => e.currentTarget.select()}
        trailing={
          state.gated ? (
            <Button size="sm" variant="primary" onClick={openVerifyEmail}>
              {ta.verify.action}
            </Button>
          ) : state.error ? (
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t.invite.retry}
            </Button>
          ) : (
            <Button
              size="sm"
              variant={copied ? 'secondary' : 'primary'}
              icon={copied ? Check : Copy}
              disabled={!state.invite}
              data-autofocus
              onClick={() => {
                void copyText(link)
                setCopied(true)
              }}
            >
              {copied ? t.invite.copied : t.invite.copy}
            </Button>
          )
        }
      />
      <div className={s.expiry}>
        <span className={s.expiryLabel}>{t.invite.expires}</span>
        <SegmentedControl<Expiry>
          label={t.invite.expires}
          value={expiry}
          onChange={setExpiry}
          items={(Object.keys(EXPIRY) as Expiry[]).map((k) => ({ value: k, label: t.invite.expiry[k] }))}
        />
        {state.invite && <span className={`${s.expiryLabel} tnum`} style={{ marginLeft: 'auto' }}>{t.invite.code(state.invite.code)}</span>}
      </div>
    </Modal>
  )
}

function LeaveSpaceModal({ open, onClose, spaceId }: { open: boolean; onClose: () => void; spaceId: string }) {
  const space = useData((st) => st.spaces[spaceId])
  const [busy, setBusy] = useState(false)
  const name = space?.name ?? ''
  const leave = async () => {
    setBusy(true)
    try {
      await leaveSpace(spaceId)
      onClose()
      useUi.getState().go({ kind: 'home' })
      toast.info(ts.space.left(name))
    } catch (e) {
      toast.error(errorText(e, t.error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ts.space.leaveTitle(name)}
      description={ts.space.leaveBody}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-autofocus>
            {ts.space.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void leave()}>
            {ts.space.leaveConfirm}
          </Button>
        </>
      }
    />
  )
}
