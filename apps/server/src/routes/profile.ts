import type { ProfileExtras, PublicUser } from '@alga/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { presenceAudience } from '../access.js'
import type { Ctx } from '../app.js'
import { relationships, users } from '../db/schema.js'
import { idParam, notFound } from '../errors.js'
import { publicUser } from '../views.js'
import { perMinute } from './users.js'

const MUTUAL_MAX = 50

/** GET /users/:id/profile: what the full profile adds to PublicUser (see ProfileExtras). */
export function profileRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub } = ctx

  app.get<{ Params: { id: string } }>('/users/:id/profile', { config: perMinute(60) }, async (req): Promise<ProfileExtras> => {
    const me = req.auth.user.id
    const id = idParam(req.params.id)
    const [target] = await db.select().from(users).where(eq(users.id, id))
    if (!target) throw notFound('Usuário não encontrado.')
    const self = id === me
    // The same people who see their presence see the rest; everyone else gets the bare minimum.
    const visible = self || (await presenceAudience(db, id)).includes(me)

    let mutualFriends: PublicUser[] = []
    if (visible && !self) {
      const friendsOf = (userId: string) =>
        db.select({ id: relationships.targetId }).from(relationships).where(and(eq(relationships.userId, userId), eq(relationships.type, 'friend')))
      const [mine, theirs] = await Promise.all([friendsOf(me), friendsOf(id)])
      const set = new Set(mine.map((r) => r.id))
      const ids = theirs.map((r) => r.id).filter((x) => set.has(x)).slice(0, MUTUAL_MAX)
      if (ids.length) mutualFriends = (await db.select().from(users).where(inArray(users.id, ids))).map(publicUser)
      mutualFriends.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
    }

    // Invisible means invisible: no trail of what they were doing either.
    const recent = visible && (self || target.statusPreference !== 'invisible') ? hub.recentOf(id) : []
    return { memberSince: target.createdAt.toISOString(), mutualFriends, recent }
  })
}
