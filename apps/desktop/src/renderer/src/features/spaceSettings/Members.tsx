import { Permission, type Member, type Role } from '@alga/shared'
import { Crown, Gavel, MoreHorizontal, Pencil, Plus, Search, UserMinus, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorText } from '@/lib/errors'
import { fold } from '@/lib/fuzzy'
import { banMember, kickMember, setMemberRole, setNickname } from '@/store/actions'
import { useData } from '@/store/data'
import { can, roleColor } from '@/store/selectors'
import { Avatar, Button, Icon, IconButton, MenuButton, Modal, TextField, toast, Tooltip, type MenuEntry } from '@/ui'
import { Group } from '../settings/Frame'
import { actorFor, byRank, canEditRole, moderationBlock, topPosition, type Actor } from './permissions'
import { t } from './strings'
import s from './spaceSettings.module.css'

type Dialog = { kind: 'nickname' | 'kick' | 'ban'; member: Member } | null

export function Members({ spaceId }: { spaceId: string }) {
  const members = useData((x) => x.members[spaceId])
  const rolesById = useData((x) => x.roles[spaceId])
  const ownerId = useData((x) => x.spaces[spaceId]?.ownerId ?? '')
  const actor = useData(useShallow((x) => actorFor(x, spaceId)))
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const roles = useMemo(() => rolesById ?? {}, [rolesById])

  const list = useMemo(() => {
    const f = fold(q.trim())
    return Object.values(members ?? {})
      .map((m) => ({ m, top: m.user.id === ownerId ? Infinity : topPosition(m.roleIds, roles), name: m.nickname || m.user.displayName }))
      .filter(({ m, name }) => !f || [name, m.user.displayName, m.user.username].some((x) => fold(x).includes(f)))
      .sort((a, b) => b.top - a.top || a.name.localeCompare(b.name, 'pt-BR'))
  }, [members, roles, ownerId, q])
  const total = Object.keys(members ?? {}).length

  return (
    <>
      <Group title={t.members.title} description={t.members.count(total)}>
        <TextField size="sm" leadingIcon={Search} ariaLabel={t.members.search} placeholder={t.members.search} value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length === 0 ? (
          <p className={s.empty}>{t.members.none}</p>
        ) : (
          <ul className={s.memberList} aria-label={t.members.title}>
            {list.map(({ m, top, name }) => (
              <MemberRow key={m.user.id} spaceId={spaceId} member={m} name={name} top={top} actor={actor} roles={roles} ownerId={ownerId} onDialog={setDialog} />
            ))}
          </ul>
        )}
      </Group>
      <NicknameDialog spaceId={spaceId} dialog={dialog?.kind === 'nickname' ? dialog : null} onClose={() => setDialog(null)} />
      <RemoveDialog spaceId={spaceId} dialog={dialog?.kind === 'kick' || dialog?.kind === 'ban' ? dialog : null} onClose={() => setDialog(null)} />
    </>
  )
}

function MemberRow({
  spaceId,
  member: m,
  name,
  top,
  actor,
  roles,
  ownerId,
  onDialog,
}: {
  spaceId: string
  member: Member
  name: string
  top: number
  actor: Actor
  roles: Record<string, Role>
  ownerId: string
  onDialog: (d: Dialog) => void
}) {
  const color = useData((x) => roleColor(x, spaceId, m.user.id))
  const self = m.user.id === actor.userId
  const manageRoles = can(actor.perms, Permission.MANAGE_ROLES)
  const block = moderationBlock(actor, { userId: m.user.id, top }, ownerId)
  const blockText = block === 'owner' ? t.members.isOwner : block === 'outranked' ? t.members.outranked : null
  const mine = byRank(m.roleIds.map((id) => roles[id]).filter((r): r is Role => !!r))
  const assignable = byRank(Object.values(roles)).filter((r) => r.id !== r.spaceId && canEditRole(actor, r))

  const toggleRole = (r: Role, on: boolean) => setMemberRole(spaceId, m.user.id, r.id, on).catch((e: unknown) => toast.error(errorText(e, t.error)))

  // Only what your permissions allow is listed; hierarchy blocks are shown disabled, with the reason once on top.
  const actions = (): MenuEntry[] => {
    const locked = !self && !!block
    const items: MenuEntry[] = []
    if (self ? can(actor.perms, Permission.CHANGE_NICKNAME) : can(actor.perms, Permission.MANAGE_NICKNAMES)) {
      items.push({ label: t.members.nickname, icon: Pencil, disabled: locked, onSelect: () => onDialog({ kind: 'nickname', member: m }) })
    }
    if (!self && can(actor.perms, Permission.KICK_MEMBERS)) {
      items.push({ label: t.members.kick, icon: UserMinus, danger: true, disabled: locked, onSelect: () => onDialog({ kind: 'kick', member: m }) })
    }
    if (!self && can(actor.perms, Permission.BAN_MEMBERS)) {
      items.push({ label: t.members.ban, icon: Gavel, danger: true, disabled: locked, onSelect: () => onDialog({ kind: 'ban', member: m }) })
    }
    if (!items.length) return [{ label: t.members.noActions, disabled: true, onSelect: () => undefined }]
    return locked && blockText ? [{ kind: 'group', label: blockText }, ...items] : items
  }

  return (
    <li className={s.memberRow}>
      <Avatar user={m.user} size={32} decorative />
      <div className={s.personText}>
        <span className={s.personName}>
          <span style={color ? { color } : undefined}>{name}</span>
          {m.nickname && <span className={s.handle}>{m.user.displayName}</span>}
          <span className={s.handle}>@{m.user.username}</span>
          {self && <span className={s.handle}>({t.members.you})</span>}
          {m.user.id === ownerId && (
            <Tooltip content={t.members.owner}>
              <span className={s.crown} role="img" aria-label={t.members.owner}>
                <Icon icon={Crown} size={14} />
              </span>
            </Tooltip>
          )}
        </span>
        <span className={s.chips}>
          {mine.map((r) => {
            const editable = manageRoles && canEditRole(actor, r)
            return (
              <span key={r.id} className={s.roleChip}>
                <span className={s.roleDotSm} style={{ background: r.color ?? 'var(--text-disabled)' }} aria-hidden />
                {r.name}
                {editable && (
                  <button type="button" className={s.chipRemove} aria-label={t.members.removeRole(r.name)} onClick={() => void toggleRole(r, false)}>
                    <Icon icon={X} size={12} />
                  </button>
                )}
              </span>
            )
          })}
          {manageRoles && (
            <MenuButton
              label={t.members.addRole}
              items={() =>
                assignable.length
                  ? assignable.map((r) => ({ label: r.name, checked: m.roleIds.includes(r.id), onSelect: () => void toggleRole(r, !m.roleIds.includes(r.id)) }))
                  : [{ label: t.members.noRoles, disabled: true, onSelect: () => undefined }]
              }
            >
              <button type="button" className={`${s.roleChip} ${s.addChip}`} aria-label={t.members.addRole}>
                <Icon icon={Plus} size={12} />
                {mine.length === 0 && t.members.addRole}
              </button>
            </MenuButton>
          )}
        </span>
      </div>
      <MenuButton items={actions} align="end" label={t.members.actions(name)}>
        <IconButton icon={MoreHorizontal} label={t.members.actions(name)} />
      </MenuButton>
    </li>
  )
}

/** Keeps the last target while the modal animates out, so its title does not flip to empty. */
function useLast<T>(v: T | null): T | null {
  const [last, setLast] = useState(v)
  if (v && v !== last) setLast(v)
  return v ?? last
}

function NicknameDialog({ spaceId, dialog, onClose }: { spaceId: string; dialog: { member: Member } | null; onClose: () => void }) {
  const m = useLast(dialog)?.member
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (dialog && shownFor !== dialog.member.user.id) {
    setShownFor(dialog.member.user.id)
    setValue(dialog.member.nickname ?? '')
    setError(null)
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!m) return
    setBusy(true)
    try {
      await setNickname(spaceId, m.user.id, value.trim() || null)
      toast.success(t.members.nicknameSaved)
      setShownFor(null)
      onClose()
    } catch (err) {
      setError(errorText(err, t.error))
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setShownFor(null)
    onClose()
  }
  return (
    <Modal
      open={!!dialog}
      onClose={close}
      title={m ? t.members.nicknameTitle(m.user.displayName) : ''}
      description={t.members.nicknameBody}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          <Button type="submit" form="nickname-form" variant="primary" loading={busy}>
            {t.save}
          </Button>
        </>
      }
    >
      <form id="nickname-form" onSubmit={submit}>
        <TextField label={t.members.nicknameLabel} value={value} placeholder={m?.user.displayName} maxLength={32} error={error} autoFocus onChange={(e) => setValue(e.target.value)} />
      </form>
    </Modal>
  )
}

function RemoveDialog({ spaceId, dialog, onClose }: { spaceId: string; dialog: { kind: 'nickname' | 'kick' | 'ban'; member: Member } | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const last = useLast(dialog)
  const m = last?.member
  const ban = last?.kind === 'ban'
  const name = m ? m.nickname || m.user.displayName : ''
  const close = () => {
    setReason('')
    onClose()
  }
  const run = async () => {
    if (!m) return
    setBusy(true)
    try {
      if (ban) await banMember(spaceId, m.user.id, reason)
      else await kickMember(spaceId, m.user.id)
      toast.success(ban ? t.members.banned(name) : t.members.kicked(name))
      close()
    } catch (e) {
      toast.error(errorText(e, t.error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={!!dialog}
      onClose={close}
      title={ban ? t.members.banTitle(name) : t.members.kickTitle(name)}
      description={ban ? t.members.banBody : t.members.kickBody}
      footer={
        <>
          <Button variant="ghost" onClick={close} data-autofocus>
            {t.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void run()}>
            {ban ? t.members.ban : t.members.kick}
          </Button>
        </>
      }
    >
      {ban && <TextField label={t.members.banReason} hint={t.members.banReasonHint} value={reason} maxLength={512} optional onChange={(e) => setReason(e.target.value)} />}
    </Modal>
  )
}
