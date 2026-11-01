/** Roles, member roles and nicknames. Hierarchy rules: see the routes block in packages/shared/src/api.ts. */
import {
  CreateRoleBody, PatchMemberBody, PatchRoleBody, Permission, ReorderRolesBody, uuidv7,
  type Member, type Role,
} from '@alga/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { assertOutranks, canManageRole, requireActor, requireSpace, spaceMemberIds, type Actor } from '../access.js'
import type { Ctx } from '../app.js'
import type { Db } from '../db/index.js'
import { memberRoles, roles, spaceMembers, type RoleRow } from '../db/schema.js'
import { badRequest, forbidden, idParam, notFound, parse } from '../errors.js'
import { memberView, roleView } from '../views.js'

const MAX_ROLES = 250

const spaceRoles = (db: Db, spaceId: string) =>
  db.select().from(roles).where(eq(roles.spaceId, spaceId)).orderBy(asc(roles.position), asc(roles.id))

async function roleIn(db: Db, spaceId: string, roleId: string): Promise<RoleRow> {
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.spaceId, spaceId)))
  if (!role) throw notFound('Cargo não encontrado.')
  return role
}

/** @everyone (id == space id) is below everyone, so any MANAGE_ROLES holder may edit it. */
function assertManageable(actor: Actor, role: RoleRow): void {
  if (role.id !== actor.space.id && !canManageRole(actor, role)) {
    throw forbidden('Você só pode gerenciar cargos abaixo do seu cargo mais alto.')
  }
}

/** `changed` = permission bits being added or removed; only bits the actor has may change. */
function assertGrantable(actor: Actor, changed: number): void {
  if (!actor.isOwner && (changed & ~actor.permissions) !== 0) throw forbidden('Você não pode conceder permissões que não tem.')
}

async function isMember(db: Db, spaceId: string, userId: string): Promise<boolean> {
  const [m] = await db.select({ id: spaceMembers.userId }).from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  return !!m
}

export function roleRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, voice } = ctx
  type P = { Params: { id: string } }
  type PR = { Params: { id: string; roleId: string } }
  type PM = { Params: { id: string; userId: string } }
  type PMR = { Params: { id: string; userId: string; roleId: string } }

  const publish = async (spaceId: string, rows: RoleRow[]) => {
    const audience = await spaceMemberIds(db, spaceId)
    for (const r of rows) hub.dispatch(audience, 'ROLE_UPSERT', roleView(r))
  }
  const publishMember = async (spaceId: string, userId: string): Promise<Member> => {
    const view = (await memberView(db, spaceId, userId))!
    hub.dispatch(await spaceMemberIds(db, spaceId), 'MEMBER_UPDATE', view)
    return view
  }

  app.get<P>('/spaces/:id/roles', async (req): Promise<Role[]> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id)
    return (await spaceRoles(db, space.id)).map(roleView)
  })

  app.post<P>('/spaces/:id/roles', async (req, reply): Promise<Role> => {
    const actor = await requireActor(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_ROLES)
    const body = parse(CreateRoleBody, req.body)
    assertGrantable(actor, body.permissions)
    const spaceId = actor.space.id
    if ((await spaceRoles(db, spaceId)).length >= MAX_ROLES) throw badRequest(`Limite de ${MAX_ROLES} cargos por espaço.`)
    const id = uuidv7()
    // New roles start at the bottom (position 1, just above @everyone); the others move up one.
    await db.transaction(async (tx) => {
      await tx.update(roles).set({ position: sql`${roles.position} + 1` }).where(and(eq(roles.spaceId, spaceId), ne(roles.id, spaceId)))
      await tx.insert(roles).values({ id, spaceId, name: body.name, color: body.color ?? null, permissions: body.permissions, position: 1 })
    })
    const all = await spaceRoles(db, spaceId)
    await publish(spaceId, all.filter((r) => r.id !== spaceId))
    reply.code(201)
    return roleView(all.find((r) => r.id === id)!)
  })

  app.patch<P>('/spaces/:id/roles', async (req): Promise<Role[]> => {
    const actor = await requireActor(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_ROLES)
    const body = parse(ReorderRolesBody, req.body)
    const spaceId = actor.space.id
    const all = await spaceRoles(db, spaceId)
    const managed = all.filter((r) => r.id !== spaceId && canManageRole(actor, r))
    const want = new Map(body.map((x) => [x.id, x.position]))
    for (const id of want.keys()) {
      if (!all.some((r) => r.id === id) || id === spaceId) throw notFound('Cargo não encontrado.')
      if (!managed.some((r) => r.id === id)) throw forbidden('Você só pode mover cargos abaixo do seu cargo mais alto.')
    }
    // The movable roles are re-sorted by the requested position and get back the same position slots, so roles at or
    // above the actor's highest one never move. A role sent to an occupied position lands there (moving up it goes
    // before the occupant, moving down after it).
    const slots = managed.map((r) => r.position)
    const key = (r: RoleRow) => {
      const w = want.get(r.id)
      return w === undefined || w === r.position ? r.position : w < r.position ? w - 0.5 : w + 0.5
    }
    const order = [...managed].sort((a, b) => key(a) - key(b) || a.position - b.position)
    const changed = order.map((r, i) => ({ ...r, position: slots[i]! })).filter((r, i) => r.position !== order[i]!.position)
    if (changed.length) {
      await db.transaction(async (tx) => {
        for (const r of changed) await tx.update(roles).set({ position: r.position }).where(eq(roles.id, r.id))
      })
      await publish(spaceId, changed)
    }
    return (await spaceRoles(db, spaceId)).map(roleView)
  })

  app.patch<PR>('/spaces/:id/roles/:roleId', async (req): Promise<Role> => {
    const actor = await requireActor(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_ROLES)
    const role = await roleIn(db, actor.space.id, idParam(req.params.roleId))
    assertManageable(actor, role)
    const body = parse(PatchRoleBody, req.body)
    if (role.id === actor.space.id && (body.name !== undefined || body.color !== undefined)) {
      throw badRequest('O cargo @everyone só permite mudar permissões.')
    }
    if (body.permissions !== undefined) assertGrantable(actor, body.permissions ^ role.permissions)
    if (!Object.keys(body).length) return roleView(role)
    const [row] = await db.update(roles).set(body).where(eq(roles.id, role.id)).returning()
    await publish(actor.space.id, [row!])
    if (row!.permissions !== role.permissions) await voice.refreshSpace(actor.space.id)
    return roleView(row!)
  })

  app.delete<PR>('/spaces/:id/roles/:roleId', async (req, reply) => {
    const actor = await requireActor(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_ROLES)
    const role = await roleIn(db, actor.space.id, idParam(req.params.roleId))
    if (role.id === actor.space.id) throw badRequest('O cargo @everyone não pode ser excluído.')
    assertManageable(actor, role)
    const holders = (await db.select({ id: memberRoles.userId }).from(memberRoles).where(eq(memberRoles.roleId, role.id))).map((h) => h.id)
    await db.delete(roles).where(eq(roles.id, role.id))
    hub.dispatch(await spaceMemberIds(db, actor.space.id), 'ROLE_DELETE', { spaceId: actor.space.id, id: role.id })
    await voice.refreshSpace(actor.space.id, holders)
    return reply.code(204).send()
  })

  const memberRole = async (req: { auth: { user: { id: string } }; params: PMR['Params'] }) => {
    const actor = await requireActor(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_ROLES)
    const role = await roleIn(db, actor.space.id, idParam(req.params.roleId))
    if (role.id === actor.space.id) throw badRequest('O cargo @everyone é implícito.')
    assertManageable(actor, role)
    const userId = idParam(req.params.userId)
    if (!(await isMember(db, actor.space.id, userId))) throw notFound('Membro não encontrado.')
    return { spaceId: actor.space.id, roleId: role.id, userId }
  }

  app.put<PMR>('/spaces/:id/members/:userId/roles/:roleId', async (req, reply) => {
    const { spaceId, roleId, userId } = await memberRole(req)
    const added = await db.insert(memberRoles).values({ spaceId, userId, roleId }).onConflictDoNothing().returning()
    if (added.length) {
      await publishMember(spaceId, userId)
      await voice.refreshSpace(spaceId, [userId])
    }
    return reply.code(204).send()
  })

  app.delete<PMR>('/spaces/:id/members/:userId/roles/:roleId', async (req, reply) => {
    const { spaceId, roleId, userId } = await memberRole(req)
    const removed = await db.delete(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.userId, userId), eq(memberRoles.roleId, roleId))).returning()
    if (removed.length) {
      await publishMember(spaceId, userId)
      await voice.refreshSpace(spaceId, [userId])
    }
    return reply.code(204).send()
  })

  app.patch<PM>('/spaces/:id/members/:userId', async (req): Promise<Member> => {
    const me = req.auth.user.id
    const self = req.params.userId === '@me' || req.params.userId === me
    const target = self ? me : idParam(req.params.userId)
    const actor = await requireActor(db, idParam(req.params.id), me, self ? Permission.CHANGE_NICKNAME : Permission.MANAGE_NICKNAMES)
    if (!self) {
      if (!(await isMember(db, actor.space.id, target))) throw notFound('Membro não encontrado.')
      await assertOutranks(db, actor, target)
    }
    const { nickname } = parse(PatchMemberBody, req.body)
    await db.update(spaceMembers).set({ nickname: nickname || null })
      .where(and(eq(spaceMembers.spaceId, actor.space.id), eq(spaceMembers.userId, target)))
    return publishMember(actor.space.id, target)
  })
}
