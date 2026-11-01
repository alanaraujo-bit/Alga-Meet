import { Permission, type ReorderRolesBody, type Role } from '@alga/shared'
import type { DataState } from '../../store/data'
import { can, spacePermissions } from '../../store/selectors'

/**
 * Mirror of the server's hierarchy rules (apps/server/src/access.ts, routes/roles.ts), so controls are disabled with
 * a reason instead of failing with 403. The server stays the authority. Pure: unit-tested in logic.test.ts.
 */
export interface Actor {
  userId: string
  isOwner: boolean
  /** Highest role position (0 = only @everyone, Infinity = owner). */
  top: number
  perms: number
}

export function actorFor(s: Pick<DataState, 'me' | 'spaces' | 'members' | 'roles'>, spaceId: string): Actor {
  const userId = s.me?.id ?? ''
  const isOwner = s.spaces[spaceId]?.ownerId === userId
  const top = isOwner ? Infinity : topPosition(s.members[spaceId]?.[userId]?.roleIds ?? [], s.roles[spaceId] ?? {})
  return { userId, isOwner, top, perms: spacePermissions(s, spaceId) }
}

export function topPosition(roleIds: readonly string[], roles: Record<string, Role>): number {
  return roleIds.reduce((m, id) => Math.max(m, roles[id]?.position ?? 0), 0)
}

export type SpaceSection = 'overview' | 'roles' | 'members' | 'bans' | 'invites'
/** Sections the viewer may open (the space menu hides the entry when the list is empty). */
export function visibleSections(a: Pick<Actor, 'perms'>): SpaceSection[] {
  const p = a.perms
  const out: SpaceSection[] = []
  if (can(p, Permission.MANAGE_SPACE)) out.push('overview')
  if (can(p, Permission.MANAGE_ROLES)) out.push('roles')
  if ([Permission.KICK_MEMBERS, Permission.BAN_MEMBERS, Permission.MANAGE_ROLES, Permission.MANAGE_NICKNAMES].some((x) => can(p, x))) out.push('members')
  if (can(p, Permission.BAN_MEMBERS)) out.push('bans')
  if (can(p, Permission.CREATE_INVITES)) out.push('invites')
  return out
}

/** @everyone (id == space id) sits below everyone: any MANAGE_ROLES holder may edit its permissions. */
export const canEditRole = (a: Actor, role: Role) => role.id === role.spaceId || a.isOwner || role.position < a.top

/** Only bits the actor has may be turned on or off (the owner may change any). */
export const canGrant = (a: Actor, bit: number) => a.isOwner || (a.perms & bit) === bit

/** Kick, ban, rename: never the owner; otherwise the actor's top role must be strictly higher. */
export function moderationBlock(a: Actor, target: { userId: string; top: number }, ownerId: string): 'owner' | 'outranked' | null {
  if (target.userId === ownerId) return 'owner'
  if (!a.isOwner && target.top >= a.top) return 'outranked'
  return null
}

/** Roles from highest to lowest; @everyone always last. */
export const byRank = (roles: Role[]): Role[] => [...roles].sort((x, y) => (x.id === x.spaceId ? 1 : y.id === y.spaceId ? -1 : y.position - x.position))

/**
 * Body for moving `roleId` one step up (+1) or down (−1) among the ranked roles: it takes its neighbour's position
 * (the server shifts the occupant). Null when the move is impossible or touches a role the actor cannot manage.
 */
export function moveBody(a: Actor, roles: Role[], roleId: string, dir: 1 | -1): ReorderRolesBody | null {
  const ranked = byRank(roles).filter((r) => r.id !== r.spaceId)
  const i = ranked.findIndex((r) => r.id === roleId)
  const neighbour = ranked[i - dir]
  const role = ranked[i]
  if (!role || !neighbour || !canEditRole(a, role) || !canEditRole(a, neighbour)) return null
  return [{ id: role.id, position: neighbour.position }]
}
