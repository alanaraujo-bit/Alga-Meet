/**
 * Casa (growth-plan §2.3): the group's purchase for a space. Contributions add days, refunds take them back, nothing
 * renews. The days live in spaces.upgrade_ends_at (Space.upgrade), rebuilt here from the paid contributions inside the
 * same transaction that changed an order. Community features are never behind it.
 */
import { Permission, type PatchSpaceUpgradeBody, type SpaceUpgrade, type SpaceUpgradeState } from '@alga/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireSpace } from '../access.js'
import type { Db, Tx } from '../db/index.js'
import { isUniqueViolation } from '../db/index.js'
import { invites, orders, spaceUpgradeContributions, spaces, users, type SpaceRow } from '../db/schema.js'
import { conflict } from '../errors.js'
import { publicUser } from '../views.js'
import { spaceUpgradePerks } from './catalog.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const spaceUpgradeState = (s: Pick<SpaceRow, 'upgradeEndsAt' | 'upgradeTone' | 'upgradeInviteCode'>, now = Date.now()): SpaceUpgradeState | null =>
  s.upgradeEndsAt
    ? {
      endsAt: s.upgradeEndsAt.toISOString(),
      active: s.upgradeEndsAt.getTime() > now,
      tone: (s.upgradeTone as SpaceUpgradeState['tone']) ?? null,
      inviteCode: s.upgradeInviteCode,
    }
    : null

/**
 * Days from the paid contributions in payment order: each adds its days to the end of the running Casa, or starts a
 * new one if the Casa had already ended. The vanity invite expires with it. true = the end changed.
 */
export async function recomputeSpace(tx: Tx, spaceId: string, counts: (provider: string) => boolean): Promise<boolean> {
  const [s] = await tx.select().from(spaces).where(eq(spaces.id, spaceId)).for('update')
  if (!s) return false
  const rows = await tx.select({ days: spaceUpgradeContributions.days, paidAt: orders.paidAt, provider: orders.provider })
    .from(spaceUpgradeContributions).innerJoin(orders, eq(orders.id, spaceUpgradeContributions.orderId))
    .where(and(eq(spaceUpgradeContributions.spaceId, spaceId), eq(orders.status, 'paid')))
    .orderBy(asc(orders.paidAt))
  let end: number | null = null
  for (const r of rows) {
    if (!counts(r.provider) || !r.paidAt) continue
    end = Math.max(end ?? 0, r.paidAt.getTime()) + r.days * DAY_MS
  }
  const endsAt = end === null ? null : new Date(end)
  if ((endsAt?.getTime() ?? null) === (s.upgradeEndsAt?.getTime() ?? null)) return false
  await tx.update(spaces).set({ upgradeEndsAt: endsAt }).where(eq(spaces.id, spaceId))
  if (s.upgradeInviteCode) {
    await tx.update(invites).set({ expiresAt: endsAt ?? new Date() })
      .where(and(eq(invites.code, s.upgradeInviteCode), eq(invites.spaceId, spaceId)))
  }
  return true
}

/** GET /spaces/:id/upgrade (members). */
export async function spaceUpgradeView(db: Db, spaceId: string, userId: string, cinema: boolean): Promise<SpaceUpgrade> {
  const { space } = await requireSpace(db, spaceId, userId)
  const wall = await db.selectDistinct({ userId: spaceUpgradeContributions.userId }).from(spaceUpgradeContributions)
    .innerJoin(orders, eq(orders.id, spaceUpgradeContributions.orderId))
    .where(and(eq(spaceUpgradeContributions.spaceId, spaceId), eq(spaceUpgradeContributions.showOnWall, true), eq(orders.status, 'paid')))
  const ids = wall.map((w) => w.userId).filter((id): id is string => !!id)
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : []
  return {
    spaceId,
    upgrade: spaceUpgradeState(space),
    perks: spaceUpgradePerks(cinema),
    contributors: people.map(publicUser).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR', { sensitivity: 'base' })),
  }
}

/**
 * PATCH /spaces/:id/upgrade (MANAGE_SPACE, while the Casa is lit): the tone and the vanity invite. The invite is an
 * ordinary `invites` row (join, list, revoke work as usual) that expires with the Casa; the code stays reserved.
 */
export async function patchSpaceUpgrade(db: Db, spaceId: string, userId: string, body: PatchSpaceUpgradeBody): Promise<void> {
  const { space } = await requireSpace(db, spaceId, userId, Permission.MANAGE_SPACE)
  const state = spaceUpgradeState(space)
  if (!state?.active) throw conflict('Os benefícios da Casa precisam dela acesa.')
  try {
    await db.transaction(async (tx) => {
      const set: Partial<SpaceRow> = {}
      if (body.tone !== undefined) set.upgradeTone = body.tone
      if (body.inviteCode !== undefined && body.inviteCode !== space.upgradeInviteCode) {
        if (space.upgradeInviteCode) await tx.delete(invites).where(and(eq(invites.code, space.upgradeInviteCode), eq(invites.spaceId, spaceId)))
        if (body.inviteCode) {
          await tx.insert(invites).values({ code: body.inviteCode, spaceId, inviterId: userId, maxUses: 0, expiresAt: space.upgradeEndsAt })
        }
        set.upgradeInviteCode = body.inviteCode
      }
      if (Object.keys(set).length) await tx.update(spaces).set(set).where(eq(spaces.id, spaceId))
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Este endereço de convite já está em uso.', { inviteCode: 'Escolha outro.' })
    throw err
  }
}
