/** Web Push subscriptions and the shared notification choices. Contract: packages/shared/src/push.ts. */
import { NotifyPrefs, PushSubscribeBody, PushUnsubscribeBody, type PushKey } from '@alga/shared'
import { and, count, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { notifyPrefs, pushSubscriptions } from '../db/schema.js'
import { invalid, parse } from '../errors.js'
import { perMinute } from './users.js'

/** A person's browsers (phone, tablet, a PC browser…); the oldest one goes when a new one is past it. */
const MAX_SUBSCRIPTIONS = 10
const EMPTY: NotifyPrefs = { levels: {}, muted: {} }

export function pushRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, push } = ctx

  app.get('/push/key', async (): Promise<PushKey> => ({ key: push.publicKey }))

  app.post('/push/subscriptions', { config: perMinute(10) }, async (req, reply) => {
    if (!push.enabled) throw invalid({ endpoint: 'As notificações no celular ainda não estão ligadas neste servidor.' })
    const me = req.auth.user.id
    const body = parse(PushSubscribeBody, req.body)
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300) || null
    await db.transaction(async (tx) => {
      // The endpoint belongs to whoever subscribed it last (a shared phone that switched accounts).
      await tx.insert(pushSubscriptions).values({ endpoint: body.endpoint, userId: me, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: me, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent } })
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, me))
      if (n > MAX_SUBSCRIPTIONS) {
        const rows = await tx.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, me)).orderBy(pushSubscriptions.createdAt).limit(n - MAX_SUBSCRIPTIONS)
        for (const r of rows) await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, r.endpoint))
      }
    })
    return reply.code(204).send()
  })

  app.delete('/push/subscriptions', async (req, reply) => {
    const { endpoint } = parse(PushUnsubscribeBody, req.body)
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.auth.user.id)))
    return reply.code(204).send()
  })

  app.get('/users/@me/notify-prefs', async (req): Promise<NotifyPrefs> => {
    const [row] = await db.select().from(notifyPrefs).where(eq(notifyPrefs.userId, req.auth.user.id))
    return (row?.prefs as NotifyPrefs | undefined) ?? EMPTY
  })

  app.put('/users/@me/notify-prefs', { config: perMinute(60) }, async (req): Promise<NotifyPrefs> => {
    const me = req.auth.user.id
    const prefs = parse(NotifyPrefs, req.body)
    await db.insert(notifyPrefs).values({ userId: me, prefs }).onConflictDoUpdate({ target: notifyPrefs.userId, set: { prefs, updatedAt: new Date() } })
    hub.dispatch([me], 'NOTIFY_PREFS_UPDATE', prefs)
    return prefs
  })
}
