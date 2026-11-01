/**
 * Recap, "Semanas juntos", activity settings, "entrou na voz" scopes, the activity e-mail unsubscribe and the shop
 * funnel (src/activity/; contract in packages/shared/src/events.ts and api.ts).
 */
import {
  PatchActivitySettingsBody, PatchWeeksTogetherBody, Permission, PutVoiceNotifyBody, SHOP_FUNNEL_STEPS,
  type ActivitySettings, type ShopFunnelStep, type VoiceNotifyScope, type VoiceNotifyScopes, type WeeklyRecap, type WeeksTogether,
} from '@alga/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireSpace } from '../access.js'
import { setActivityEmail, verifyUnsubscribe } from '../activity/email.js'
import { recapView, setWeeksTogether, weeksTogetherView } from '../activity/recap.js'
import type { Ctx } from '../app.js'
import { productById } from '../billing/catalog.js'
import { forbidden, idParam, parse } from '../errors.js'
import { metrics } from '../metrics.js'
import { routeOf } from '../observability.js'
import { perMinute } from './users.js'

const RecapQuery = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
const UnsubscribeQuery = z.object({ u: z.uuid(), sig: z.string().min(1).max(128) })

const UNSUBSCRIBED_PAGE = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>Alga Meet</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;line-height:1.5">' +
  '<h1 style="font-size:20px">Pronto.</h1><p>Você não vai mais receber e-mails de atividade do Alga Meet. ' +
  'Se mudar de ideia, ative de novo nas configurações do app.</p></body></html>'

export function activityPublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  // Mail clients' one-click unsubscribe (RFC 8058) posts a form; only these routes accept it.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  const unsubscribe = async (req: FastifyRequest): Promise<void> => {
    const q = parse(UnsubscribeQuery, req.query)
    if (!verifyUnsubscribe(ctx, q.u, q.sig)) throw forbidden('Link inválido.')
    await setActivityEmail(ctx, q.u, false).catch(() => {}) // an account that is gone has nothing left to stop
  }
  app.get('/email/unsubscribe', { config: perMinute(30) }, async (req, reply) => {
    await unsubscribe(req)
    return reply.headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" })
      .send(UNSUBSCRIBED_PAGE)
  })
  app.post('/email/unsubscribe', { config: perMinute(30) }, async (req, reply) => {
    await unsubscribe(req)
    return reply.code(204).send()
  })
}

export function activityRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, activity } = ctx

  app.get('/users/@me/recap', { config: perMinute(60) }, async (req): Promise<{ recap: WeeklyRecap | null }> => {
    const { week } = parse(RecapQuery, req.query)
    return { recap: await recapView(ctx, req.auth.user.id, week) }
  })

  app.get<{ Params: { id: string } }>('/spaces/:id/weeks-together', { config: perMinute(60) }, async (req): Promise<WeeksTogether> => {
    const spaceId = idParam(req.params.id)
    await requireSpace(db, spaceId, req.auth.user.id)
    return weeksTogetherView(ctx, spaceId)
  })

  app.patch<{ Params: { id: string } }>('/spaces/:id/weeks-together', { config: perMinute(10) }, async (req): Promise<WeeksTogether> => {
    const spaceId = idParam(req.params.id)
    await requireSpace(db, spaceId, req.auth.user.id, Permission.MANAGE_SPACE)
    await setWeeksTogether(ctx, spaceId, parse(PatchWeeksTogetherBody, req.body).enabled)
    return weeksTogetherView(ctx, spaceId)
  })

  app.get('/users/@me/activity-settings', { config: perMinute(30) }, async (req): Promise<ActivitySettings> => activity.settings(req.auth.user))

  app.patch('/users/@me/activity-settings', { config: perMinute(10) }, async (req): Promise<ActivitySettings> =>
    activity.patchSettings(req.auth.user, parse(PatchActivitySettingsBody, req.body)))

  app.get('/users/@me/voice-notify', { config: perMinute(30) }, async (req): Promise<VoiceNotifyScopes> =>
    ({ scopes: await activity.voiceNotify(req.auth.user.id) }))

  app.put<{ Params: { scopeId: string } }>('/users/@me/voice-notify/:scopeId', { config: perMinute(30) }, async (req): Promise<VoiceNotifyScope> =>
    activity.putVoiceNotify(req.auth.user.id, idParam(req.params.scopeId), parse(PutVoiceNotifyBody, req.body).notify))

  app.post('/shop/opened', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (_req, reply) => {
    countShop('shop_open', 'none')
    return reply.code(204).send()
  })
}

// ---- shop funnel (growth-plan §4.5 item 3): fixed labels, never a user ----------------------------------------------

const PRODUCT_TYPES = ['plan', 'cosmetic', 'bundle', 'space_upgrade'] as const
/** Successful (201) billing routes and the step they are. The billing code itself is not touched. */
const FUNNEL_ROUTES: Record<string, ShopFunnelStep> = {
  'POST /api/v1/billing/try-on': 'try_on',
  'POST /api/v1/billing/checkout': 'checkout',
  'POST /api/v1/spaces/:id/upgrade/contributions': 'checkout',
  'POST /api/v1/billing/gifts': 'gift_checkout',
}

/** Labels are clamped to SHOP_FUNNEL_STEPS × (PRODUCT_TYPES + none + other): nothing from a request reaches them. */
export function countShop(step: string, productType: string): void {
  metrics.shopFunnel.inc({
    step: (SHOP_FUNNEL_STEPS as readonly string[]).includes(step) ? step : 'other',
    product_type: productType === 'none' || (PRODUCT_TYPES as readonly string[]).includes(productType) ? productType : 'other',
  })
}

/** Root onResponse hook. */
export async function shopFunnelHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (reply.statusCode !== 201) return
  const step = FUNNEL_ROUTES[`${req.method} ${routeOf(req)}`]
  if (!step) return
  const id = (req.body as { productId?: unknown } | undefined)?.productId
  countShop(step, (typeof id === 'string' && productById(id)?.kind) || 'other')
}
