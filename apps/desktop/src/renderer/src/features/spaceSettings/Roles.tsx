import { Permission, type Role } from '@alga/shared'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Lock, Plus, Trash2 } from '@/ui/icons'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorText } from '@/lib/errors'
import { createRole, deleteRole, patchRole, reorderRoles } from '@/store/actions'
import { useData } from '@/store/data'
import { Button, Icon, IconButton, Modal, Switch, TextField, toast, Tooltip } from '@/ui'
import { Group, Row } from '../settings/Frame'
import { actorFor, byRank, canEditRole, canGrant, moveBody, type Actor } from './permissions'
import { PERMISSION_GROUPS, ROLE_COLORS, t } from './strings'
import st from '../settings/settings.module.css'
import s from './spaceSettings.module.css'

function useActor(spaceId: string): Actor {
  return useData(useShallow((x) => actorFor(x, spaceId)))
}

/** Why a role cannot be edited by this actor (null = it can). */
function lockReason(a: Actor, role: Role, roles: Role[]): string | null {
  if (canEditRole(a, role)) return null
  const top = byRank(roles).find((r) => r.position === a.top && r.id !== r.spaceId)
  return top ? t.roles.lockedAbove(top.name) : t.roles.lockedNone
}

export function Roles({ spaceId }: { spaceId: string }) {
  const [editing, setEditing] = useState<string | null>(null)
  const exists = useData((x) => !!(editing && x.roles[spaceId]?.[editing]))
  useEffect(() => {
    if (editing && !exists) setEditing(null)
  }, [editing, exists])
  return editing && exists ? <RoleEditor spaceId={spaceId} roleId={editing} onBack={() => setEditing(null)} /> : <RoleList spaceId={spaceId} onEdit={setEditing} />
}

function RoleList({ spaceId, onEdit }: { spaceId: string; onEdit: (id: string) => void }) {
  const rolesById = useData((x) => x.roles[spaceId])
  const members = useData((x) => x.members[spaceId])
  const actor = useActor(spaceId)
  const roles = useMemo(() => byRank(Object.values(rolesById ?? {})), [rolesById])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of Object.values(members ?? {})) for (const id of m.roleIds) c[id] = (c[id] ?? 0) + 1
    return c
  }, [members])
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    try {
      const r = await createRole(spaceId, { name: t.roles.newName, permissions: 0 })
      onEdit(r.id)
    } catch (e) {
      toast.error(errorText(e, t.error))
    } finally {
      setCreating(false)
    }
  }
  const move = (r: Role, dir: 1 | -1) => {
    const body = moveBody(actor, roles, r.id, dir)
    if (!body) return
    setMoving(r.id)
    reorderRoles(spaceId, body)
      .catch((e: unknown) => toast.error(errorText(e, t.error)))
      .finally(() => setMoving(null))
  }

  return (
    <Group
      title={t.roles.title}
      description={t.roles.body}
      action={
        <Button size="sm" variant="primary" icon={Plus} loading={creating} onClick={() => void create()}>
          {t.roles.create}
        </Button>
      }
    >
      <ul className={s.roleList} aria-label={t.roles.title}>
        {roles.map((r) => {
          const everyone = r.id === r.spaceId
          const lock = lockReason(actor, r, roles)
          const up = !everyone && moveBody(actor, roles, r.id, 1)
          const down = !everyone && moveBody(actor, roles, r.id, -1)
          return (
            <li key={r.id} className={s.roleRow}>
              <span className={s.roleDot} style={{ background: r.color ?? 'var(--text-disabled)' }} aria-hidden />
              <button type="button" className={s.roleMain} onClick={() => onEdit(r.id)} aria-label={t.roles.edit(r.name)}>
                <span className={s.roleName} style={r.color ? { color: r.color } : undefined}>
                  {r.name}
                </span>
                <span className={s.roleMeta}>{everyone ? t.roles.everyoneHint : t.roles.members(counts[r.id] ?? 0)}</span>
                {!everyone && r.position === actor.top && <span className={s.chip}>{t.roles.yourTop}</span>}
              </button>
              {lock && (
                <Tooltip content={lock}>
                  <span className={s.lock} role="img" aria-label={lock}>
                    <Icon icon={Lock} size={14} />
                  </span>
                </Tooltip>
              )}
              {!everyone && (
                <span className={s.roleMove}>
                  <IconButton icon={ArrowUp} label={t.roles.up(r.name)} size="sm" disabledReason={up ? undefined : lock ?? t.roles.up(r.name)} aria-busy={moving === r.id} onClick={() => move(r, 1)} />
                  <IconButton icon={ArrowDown} label={t.roles.down(r.name)} size="sm" disabledReason={down ? undefined : lock ?? t.roles.down(r.name)} aria-busy={moving === r.id} onClick={() => move(r, -1)} />
                </span>
              )}
              <Icon icon={ChevronRight} size={16} className={s.chev} />
            </li>
          )
        })}
      </ul>
    </Group>
  )
}

function RoleEditor({ spaceId, roleId, onBack }: { spaceId: string; roleId: string; onBack: () => void }) {
  const role = useData((x) => x.roles[spaceId]?.[roleId])!
  const rolesById = useData((x) => x.roles[spaceId])
  const holders = useData((x) => Object.values(x.members[spaceId] ?? {}).filter((m) => m.roleIds.includes(roleId)).length)
  const actor = useActor(spaceId)
  const roles = useMemo(() => Object.values(rolesById ?? {}), [rolesById])
  const everyone = role.id === role.spaceId
  const lock = lockReason(actor, role, roles)
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState<string | null>(role.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  // Follow live edits (gateway ROLE_UPSERT) of the role.
  useEffect(() => setName(role.name), [role.name])
  useEffect(() => setColor(role.color), [role.color])
  const dirty = !everyone && (name.trim() !== role.name || color !== role.color) && !!name.trim()
  // Esc goes back to the list first (the settings frame closes on the next Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="menu"], [role="dialog"]:not([data-settings])')) return
      e.preventDefault()
      e.stopPropagation()
      onBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onBack])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || lock) return
    setBusy(true)
    setError(null)
    try {
      await patchRole(spaceId, roleId, { name: name.trim(), color })
      toast.success(t.roles.saved)
    } catch (err) {
      setError(errorText(err, t.error))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (bit: number, on: boolean) => {
    const next = on ? role.permissions | bit : role.permissions & ~bit
    patchRole(spaceId, roleId, { permissions: next }).catch((e: unknown) => toast.error(errorText(e, t.error)))
  }

  return (
    <>
      <div className={s.editorHead}>
        <IconButton icon={ChevronLeft} label={t.roles.back} shortcut="Esc" onClick={onBack} />
        <span className={s.roleDot} style={{ background: role.color ?? 'var(--text-disabled)' }} aria-hidden />
        <h3 className={s.editorTitle} style={role.color ? { color: role.color } : undefined}>
          {role.name}
        </h3>
        {!everyone && <span className={s.roleMeta}>{t.roles.members(holders)}</span>}
      </div>
      {lock && (
        <p className={s.notice} role="note">
          <Icon icon={Lock} size={14} />
          {lock}
        </p>
      )}
      <Group>
        {everyone ? (
          <p className={st.rowHint}>{t.roles.everyoneLocked}</p>
        ) : (
          <form className={st.profileFields} onSubmit={save}>
            <TextField label={t.roles.name} value={name} maxLength={100} disabled={!!lock} error={error} onChange={(e) => setName(e.target.value)} />
            <div className={st.textareaField}>
              <span className={st.fieldLabel}>{t.roles.color}</span>
              <div className={st.swatches} role="radiogroup" aria-label={t.roles.color}>
                <button type="button" role="radio" aria-checked={color === null} disabled={!!lock} className={`${st.swatch} ${s.swatchNone}`} aria-label={t.roles.noColor} onClick={() => setColor(null)} />
                {ROLE_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={color === c} disabled={!!lock} className={st.swatch} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
            <div className={st.formActions}>
              <Button type="submit" variant="primary" loading={busy} disabled={!dirty || !!lock}>
                {t.save}
              </Button>
            </div>
          </form>
        )}
      </Group>
      {PERMISSION_GROUPS.map((g) => (
        <Group key={g.title} title={g.title} description={g.title === 'Geral' && role.permissions & Permission.ADMINISTRATOR ? t.roles.adminNote : undefined}>
          {g.items.map((p) => {
            const bit = Permission[p.key]
            const grantable = canGrant(actor, bit)
            const id = `perm-${p.key}`
            return (
              <Row key={p.key} label={p.label} htmlFor={id} hint={!lock && !grantable ? `${p.hint} ${t.roles.cantGrant}` : p.hint}>
                <Switch id={id} checked={(role.permissions & bit) === bit} disabled={!!lock || !grantable} onChange={(on) => toggle(bit, on)} />
              </Row>
            )
          })}
        </Group>
      ))}
      {!everyone && (
        <Group>
          <Row label={t.roles.delete} hint={t.roles.deleteBody(holders)}>
            <Button variant="secondary-danger" icon={Trash2} disabled={!!lock} onClick={() => setConfirm(true)}>
              {t.roles.delete}
            </Button>
          </Row>
        </Group>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t.roles.deleteTitle(role.name)}
        description={t.roles.deleteBody(holders)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} data-autofocus>
              {t.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const n = role.name
                setConfirm(false)
                deleteRole(spaceId, roleId).then(
                  () => toast.success(t.roles.deleted(n)),
                  (e: unknown) => toast.error(errorText(e, t.error)),
                )
              }}
            >
              {t.roles.delete}
            </Button>
          </>
        }
      />
    </>
  )
}
