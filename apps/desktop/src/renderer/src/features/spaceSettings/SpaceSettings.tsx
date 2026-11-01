import type { Ban, Invite } from '@alga/shared'
import { Check, Copy, Gavel, LayoutGrid, Link, Shield, Trash2, Users } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { copyText } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { inviteLink } from '@/lib/invite'
import { createInvite, deleteSpace, listBans, patchSpace, unban, uploadSpaceIcon } from '@/store/actions'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { Avatar, Button, Modal, SegmentedControl, Spinner, TextField, tintFor, toast } from '@/ui'
import { initials } from '@/ui/Avatar'
import { Group, Row, SettingsFrame, type FrameNav } from '../settings/Frame'
import { ImagePicker } from '../settings/ImagePicker'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { t as ta } from '../auth/strings'
import { Members } from './Members'
import { actorFor, visibleSections, type SpaceSection } from './permissions'
import { Roles } from './Roles'
import { t } from './strings'
import st from '../settings/settings.module.css'
import s from './spaceSettings.module.css'

/** Space settings overlay (same frame as user settings). null = closed. */
export const useSpaceSettings = create<{ spaceId: string | null; section: SpaceSection }>()(() => ({ spaceId: null, section: 'overview' }))
export function openSpaceSettings(spaceId: string, section?: SpaceSection): void {
  const allowed = visibleSections(actorFor(useData.getState(), spaceId))
  const next = section && allowed.includes(section) ? section : allowed[0]
  if (next) useSpaceSettings.setState({ spaceId, section: next })
}
const close = () => useSpaceSettings.setState({ spaceId: null })

export function SpaceSettingsOverlay() {
  const spaceId = useSpaceSettings((x) => x.spaceId)
  return createPortal(<AnimatePresence>{spaceId && <Panel key={spaceId} spaceId={spaceId} />}</AnimatePresence>, document.body)
}

const NAV_ICON = { overview: LayoutGrid, roles: Shield, invites: Link, members: Users, bans: Gavel } as const

function Panel({ spaceId }: { spaceId: string }) {
  const section = useSpaceSettings((x) => x.section)
  const space = useData((x) => x.spaces[spaceId])
  // Re-derived on every role/member change: a permission lost mid-session closes what is no longer allowed.
  const allowed = useData((x) => visibleSections(actorFor(x, spaceId)).join(','))
  const sections = useMemo(() => allowed.split(',').filter(Boolean) as SpaceSection[], [allowed])
  useEffect(() => {
    if (!space || sections.length === 0) close()
    else if (!sections.includes(section)) useSpaceSettings.setState({ section: sections[0]! })
  }, [space, sections, section])
  if (!space || !sections.includes(section)) return null

  const nav: Array<FrameNav<SpaceSection>> = [
    { group: t.groups.space, items: (['overview', 'roles', 'invites'] as const).filter((x) => sections.includes(x)).map((id) => ({ id, label: t.nav[id], icon: NAV_ICON[id] })) },
    { group: t.groups.people, items: (['members', 'bans'] as const).filter((x) => sections.includes(x)).map((id) => ({ id, label: t.nav[id], icon: NAV_ICON[id] })) },
  ].filter((g) => g.items.length)

  return (
    <SettingsFrame label={t.label(space.name)} navTitle={space.name} nav={nav} section={section} onSelect={(x) => useSpaceSettings.setState({ section: x })} onClose={close} closeLabel={t.close}>
      {section === 'overview' && <Overview spaceId={spaceId} />}
      {section === 'roles' && <Roles spaceId={spaceId} />}
      {section === 'members' && <Members spaceId={spaceId} />}
      {section === 'bans' && <Bans spaceId={spaceId} />}
      {section === 'invites' && <Invites spaceId={spaceId} />}
    </SettingsFrame>
  )
}

export function SpaceTile({ spaceId, size }: { spaceId: string; size: number }) {
  const space = useData((x) => x.spaces[spaceId])
  if (!space) return null
  return (
    <span className={s.tile} style={{ width: size, height: size, ...(space.iconUrl ? {} : { background: tintFor(spaceId) }) }}>
      {space.iconUrl ? <img src={space.iconUrl} alt="" draggable={false} /> : initials(space.name)}
    </span>
  )
}

// ── Visão geral ────────────────────────────────────────

function Overview({ spaceId }: { spaceId: string }) {
  const space = useData((x) => x.spaces[spaceId])!
  const isOwner = useData((x) => x.me?.id === space.ownerId)
  const [name, setName] = useState(space.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const dirty = name.trim() !== space.name && !!name.trim()
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty) return
    setBusy(true)
    setError(null)
    try {
      await patchSpace(spaceId, { name: name.trim() })
      toast.success(t.overview.saved)
    } catch (err) {
      setError(errorText(err, t.error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title={t.overview.identity}>
        <div className={st.profileFields}>
          <ImagePicker
            shape="rounded"
            hasImage={!!space.iconUrl}
            preview={<SpaceTile spaceId={spaceId} size={80} />}
            onUpload={(file, n) => uploadSpaceIcon(spaceId, file, n).then(() => toast.success(t.overview.iconSaved))}
            onRemove={() => patchSpace(spaceId, { iconUrl: null }).then(() => toast.success(t.overview.iconRemoved))}
          />
          <form className={s.inline} onSubmit={save}>
            <div className={s.grow}>
              <TextField label={t.overview.name} value={name} maxLength={100} error={error} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
              {t.save}
            </Button>
          </form>
        </div>
      </Group>
      <Group title={t.overview.danger}>
        <Row label={t.overview.delete} hint={isOwner ? t.overview.deleteBody : t.overview.ownerOnly}>
          <Button variant="danger" icon={Trash2} disabled={!isOwner} onClick={() => setDeleting(true)}>
            {t.overview.delete}
          </Button>
        </Row>
      </Group>
      <DeleteSpace open={deleting} spaceId={spaceId} onClose={() => setDeleting(false)} />
    </>
  )
}

function DeleteSpace({ open, spaceId, onClose }: { open: boolean; spaceId: string; onClose: () => void }) {
  const name = useData((x) => x.spaces[spaceId]?.name ?? '')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setTyped(''), [open])
  const run = async () => {
    setBusy(true)
    try {
      await deleteSpace(spaceId)
      close()
      useUi.getState().go({ kind: 'home' })
      toast.info(t.overview.deleted(name))
    } catch (e) {
      toast.error(errorText(e, t.error))
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.overview.deleteTitle(name)}
      description={t.overview.deleteBody}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="danger" loading={busy} disabled={typed.trim() !== name} onClick={() => void run()}>
            {t.overview.delete}
          </Button>
        </>
      }
    >
      <TextField label={t.overview.deleteConfirm(name)} value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
    </Modal>
  )
}

// ── Banimentos ─────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })

function Bans({ spaceId }: { spaceId: string }) {
  const [list, setList] = useState<Ban[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => {
    setError(null)
    listBans(spaceId).then(
      (l) => setList(l.sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      (e: unknown) => setError(errorText(e, t.bans.loadError)),
    )
  }
  useEffect(load, [spaceId])
  return (
    <Group title={t.bans.title} description={t.bans.body}>
      {error ? (
        <Row label={<span className={st.error}>{error}</span>}>
          <Button size="sm" onClick={load}>
            {t.retry}
          </Button>
        </Row>
      ) : !list ? (
        <Row label={<Spinner size={16} label="Carregando" />} />
      ) : list.length === 0 ? (
        <p className={s.empty}>{t.bans.empty}</p>
      ) : (
        list.map((b) => (
          <div key={b.user.id} className={s.personRow}>
            <Avatar user={b.user} size={32} decorative />
            <span className={s.personText}>
              <span className={s.personName}>
                {b.user.displayName} <span className={s.handle}>@{b.user.username}</span>
              </span>
              <span className={s.personSub}>
                {b.reason || t.bans.noReason} · {t.bans.since(dateFmt.format(new Date(b.createdAt)))}
              </span>
            </span>
            <Button
              size="sm"
              loading={busy === b.user.id}
              onClick={() => {
                setBusy(b.user.id)
                unban(spaceId, b.user.id)
                  .then(() => {
                    setList((l) => l?.filter((x) => x.user.id !== b.user.id) ?? null)
                    toast.success(t.bans.revoked(b.user.displayName))
                  })
                  .catch((e: unknown) => toast.error(errorText(e, t.error)))
                  .finally(() => setBusy(null))
              }}
            >
              {t.bans.revoke}
            </Button>
          </div>
        ))
      )}
    </Group>
  )
}

// ── Convites ───────────────────────────────────────────

const EXPIRY = { h1: 3600, d1: 86400, d7: 604800, d30: 2592000, never: 0 } as const
const USES = { u0: 0, u1: 1, u5: 5, u10: 10, u25: 25, u100: 100 } as const
const relFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Invites made in this session, per space (the API has no list route yet). */
const made = new Map<string, Invite[]>()

function Invites({ spaceId }: { spaceId: string }) {
  const [expiry, setExpiry] = useState<keyof typeof EXPIRY>('d7')
  const [uses, setUses] = useState<keyof typeof USES>('u0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  const [list, setList] = useState<Invite[]>(() => made.get(spaceId) ?? [])
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const inv = await createInvite(spaceId, EXPIRY[expiry], USES[uses])
      const next = [inv, ...list]
      made.set(spaceId, next)
      setList(next)
    } catch (e) {
      setError({ text: errorText(e, t.error), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title={t.invites.title} description={t.invites.body}>
        <Row label={t.invites.expires} hint={expiry === 'never' ? t.invites.neverWarn : undefined}>
          <SegmentedControl label={t.invites.expires} value={expiry} onChange={setExpiry} items={(Object.keys(EXPIRY) as Array<keyof typeof EXPIRY>).map((k) => ({ value: k, label: t.invites.expiry[k] }))} />
        </Row>
        <Row label={t.invites.uses}>
          <SegmentedControl label={t.invites.uses} value={uses} onChange={setUses} items={(Object.keys(USES) as Array<keyof typeof USES>).map((k) => ({ value: k, label: t.invites.usesOpt[k] }))} />
        </Row>
        <div className={st.formActions}>
          {error && (
            <span className={`${st.rowHint} ${st.error}`} role="alert">
              {error.text}
            </span>
          )}
          {error?.gated ? (
            <Button variant="primary" onClick={openVerifyEmail}>
              {ta.verify.action}
            </Button>
          ) : (
            <Button variant="primary" icon={Link} loading={busy} onClick={() => void create()}>
              {t.invites.create}
            </Button>
          )}
        </div>
      </Group>
      {list.length > 0 && (
        <Group title={t.invites.created}>
          {list.map((inv) => (
            <InviteRow key={inv.code} invite={inv} />
          ))}
        </Group>
      )}
    </>
  )
}

function InviteRow({ invite }: { invite: Invite }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  const link = inviteLink(invite.code)
  return (
    <Row label={<span className={s.inviteLink}>{link}</span>} hint={t.invites.meta(invite.expiresAt ? relFmt.format(new Date(invite.expiresAt)) : null, invite.maxUses)}>
      <Button
        size="sm"
        variant={copied ? 'secondary' : 'primary'}
        icon={copied ? Check : Copy}
        onClick={() => {
          void copyText(link)
          setCopied(true)
        }}
      >
        {copied ? t.invites.copied : t.invites.copy}
      </Button>
    </Row>
  )
}
