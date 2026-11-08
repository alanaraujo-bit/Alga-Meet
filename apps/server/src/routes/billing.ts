import {
  AnnualItemBody, CheckoutBody, GiftBody, PatchSpaceUpgradeBody, PatchWishlistBody, PayBody, PlusPassBody, SpaceContributionBody, TryOnBody,
  type BillingCatalog, type BillingMe, type CheckoutResponse, type Gift, type Order, type PayResponse, type Quote, type SpaceUpgrade, type Subscription,
  type TryOn, type Wishlist,
} from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { requireSpace } from '../access.js'
import { requireVerifiedEmail } from '../auth.js'
import { cardFrameHtml } from '../billing/card-frame.js'
import { patchSpaceUpgrade, spaceUpgradeView } from '../billing/casa.js'
import { WebhookRejected } from '../billing/provider.js'
import { addToWishlist, friendWishlist, removeFromWishlist, setWishlistVisible, wishlistOf } from '../billing/wishlist.js'
import type { Config } from '../config.js'
import type { UserRow } from '../db/schema.js'
import { HttpError, forbidden, idParam, notFound, parse } from '../errors.js'
import { ageBracketOf } from '../legal.js'
import { metrics } from '../metrics.js'
import { perMinute } from './users.js'

const perHour = (max: number) => ({ rateLimit: { max, timeWindow: '1 hour' } })

/**
 * Código Civil art. 4º: 16-17 are relatively incapable; until a guardian flow exists, every purchase (gifts, Casa
 * and Plus passes included) is 18+ only.
 */
function requireAdultBuyer(user: UserRow, config: Config, what = 'fazer compras'): void {
  requireVerifiedEmail(user, what)
  const age = ageBracketOf(user)
  if (age === 'teen') throw forbidden('Compras no Alga Meet exigem 18 anos ou mais.')
  if (age === 'unknown' && config.legal.requireBirthDate) throw forbidden('Informe sua data de nascimento antes de comprar.')
}

/** Catalog, provider webhooks (encapsulated raw-body parser) and the sandbox's fake payment page. */
export async function billingPublicRoutes(app: FastifyInstance, { billing }: Ctx): Promise<void> {
  app.get('/billing/catalog', async (): Promise<BillingCatalog> => billing.catalog())

  await app.register(async (hook) => {
    // Raw text: the sandbox signs the exact bytes; Mercado Pago's body is only read for the event id and type.
    hook.removeContentTypeParser('application/json')
    hook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body))
    // Server-to-server and signature-checked; generous ceiling per IP because providers retry in bursts.
    hook.post<{ Params: { provider: string } }>('/billing/webhooks/:provider', { config: perMinute(600) }, async (req) => {
      const provider = ['sandbox', 'mercadopago', 'stripe'].includes(req.params.provider) ? req.params.provider : 'other'
      let outcome = 'error'
      try {
        const { duplicate } = await billing.handleWebhook(req.params.provider, {
          rawBody: typeof req.body === 'string' ? req.body : '',
          headers: req.headers,
          query: req.query as Record<string, unknown>,
        })
        outcome = duplicate ? 'duplicate' : 'applied'
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 404) outcome = 'unknown_provider'
        if (!(err instanceof WebhookRejected)) throw err
        outcome = 'rejected'
        req.log.warn({ provider: req.params.provider, reason: err.message }, 'billing webhook rejected')
        throw new HttpError('unauthorized', 'Assinatura do webhook inválida.')
      } finally {
        metrics.billingWebhooks.inc({ provider, outcome })
      }
      return { ok: true }
    })
  })

  // BILLING_RETURN_URL in production: where Mercado Pago sends the buyer back. Static on purpose: the query string
  // (collection_status, …) is client-controlled, so state only ever comes from the webhook (ENTITLEMENTS_UPDATE).
  app.get('/billing/return', { config: perMinute(30) }, async (_req, reply) =>
    reply.type('text/html; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").send(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Alga Meet</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0f13;color:#e6e7ea;' +
      'font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}main{max-width:420px;text-align:center}' +
      'a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:8px;background:#5e6ad2;color:#fff;text-decoration:none}' +
      'p{color:#a3a6ae}</style><main><h1>Pagamento enviado</h1>' +
      '<p>Assim que o Mercado Pago confirmar, o Alga Meet libera tudo sozinho. Pix e cartão costumam levar segundos.</p>' +
      '<p>Pode fechar esta aba.</p><a href="algameet://billing">Voltar ao Alga Meet</a></main></html>',
    ))

  // The in-app checkout's card form (src/billing/card-frame.ts), framed by the desktop modal. Static per key + accent.
  app.get<{ Querystring: { accent?: string } }>('/billing/card-frame', { config: perMinute(60) }, async (req, reply) => {
    const key = billing.cardFrameKey
    if (!key) throw notFound('Pagamento no app indisponível.')
    const accent = /^[0-9a-f]{6}$/i.test(String(req.query.accent ?? '')) ? String(req.query.accent) : '8b8ef7'
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'strict-origin')
      .send(cardFrameHtml(key, accent))
  })

  if (!billing.sandbox) return
  app.get<{ Params: { reference: string }; Querystring: { sig?: string; outcome?: string } }>(
    '/billing/sandbox/checkout/:reference', { config: perMinute(30) }, async (req, reply) => {
      const outcome = req.query.outcome === 'decline' ? 'decline' : 'approve'
      const kind = await billing.sandboxCheckout(idParam(req.params.reference), String(req.query.sig ?? ''), outcome)
      const what = kind === 'subscription' ? 'Assinatura' : 'Compra'
      const result = outcome === 'approve' ? 'aprovada' : 'recusada'
      return reply.type('text/html; charset=utf-8').header('content-security-policy', "default-src 'none'").send(
        `<!doctype html><meta charset="utf-8"><title>Sandbox</title><p><b>SANDBOX</b>: ${what} ${result}. Nada foi cobrado.</p>` +
        '<p>Pode fechar esta aba e voltar ao Alga Meet.</p>',
      )
    })
}

export function billingRoutes(app: FastifyInstance, { billing, config, db }: Ctx): void {
  app.get('/billing/me', async (req): Promise<BillingMe> => billing.me(req.auth.user))

  app.get<{ Querystring: { productId?: string; recipientId?: string } }>('/billing/quote', { config: perMinute(60) }, async (req): Promise<Quote> =>
    billing.quote(req.auth.user, String(req.query.productId ?? ''), req.query.recipientId ? idParam(req.query.recipientId) : undefined))

  // Each call creates an object at the provider (preapproval / preference): per hour, not per minute.
  app.post('/billing/checkout', { config: perHour(10) }, async (req, reply): Promise<CheckoutResponse> => {
    const { productId } = parse(CheckoutBody, req.body)
    requireAdultBuyer(req.auth.user, config)
    const res = await billing.checkout(req.auth.user, productId)
    reply.code(201)
    return res
  })

  // In-app payment of a pending checkout: card token or Pix QR. Card retries count, so per hour and generous.
  app.post('/billing/pay', { config: perHour(30) }, async (req): Promise<PayResponse> => {
    requireAdultBuyer(req.auth.user, config)
    return billing.pay(req.auth.user, parse(PayBody, req.body))
  })

  // Every real change is a provider API call (idempotent repeats are not): a cancel/resume loop must not drain the quota.
  app.post('/billing/subscription/cancel', { config: perHour(10) }, async (req): Promise<Subscription> => billing.cancel(req.auth.user.id))
  app.post('/billing/subscription/resume', { config: perHour(10) }, async (req): Promise<Subscription> => billing.resume(req.auth.user.id))
  app.post('/billing/subscription/refund', { config: perHour(10) }, async (req): Promise<Subscription> => billing.refundSubscription(req.auth.user))
  app.post<{ Params: { id: string } }>('/billing/orders/:id/refund', { config: perHour(10) }, async (req): Promise<Order> =>
    billing.refundOrder(req.auth.user, idParam(req.params.id)))

  // ---- gifts and Plus ----
  app.post('/billing/gifts', { config: perHour(10) }, async (req, reply): Promise<CheckoutResponse> => {
    const body = parse(GiftBody, req.body)
    requireAdultBuyer(req.auth.user, config, 'dar presentes')
    const res = await billing.gift(req.auth.user, body)
    reply.code(201)
    return res
  })
  app.post<{ Params: { id: string } }>('/billing/gifts/:id/accept', { config: perMinute(20) }, async (req): Promise<Gift> =>
    billing.acceptGift(req.auth.user, idParam(req.params.id)))
  // Refusing asks the provider for a refund.
  app.post<{ Params: { id: string } }>('/billing/gifts/:id/decline', { config: perHour(20) }, async (req): Promise<Gift> =>
    billing.declineGift(req.auth.user, idParam(req.params.id)))
  app.post('/billing/passes', { config: perHour(10) }, async (req, reply): Promise<Gift> => {
    const body = parse(PlusPassBody, req.body)
    requireAdultBuyer(req.auth.user, config, 'dar convites Plus')
    const res = await billing.givePass(req.auth.user, body)
    reply.code(201)
    return res
  })
  app.post('/billing/plus/annual-item', { config: perHour(10) }, async (req): Promise<Order> =>
    billing.claimAnnualItem(req.auth.user, parse(AnnualItemBody, req.body).productId))

  // ---- wishlist ----
  app.get('/billing/wishlist', async (req): Promise<Wishlist> => wishlistOf(db, billing, req.auth.user))
  app.patch('/billing/wishlist', { config: perMinute(30) }, async (req): Promise<Wishlist> =>
    setWishlistVisible(db, billing, req.auth.user, parse(PatchWishlistBody, req.body).visible))
  app.put<{ Params: { productId: string } }>('/billing/wishlist/:productId', { config: perMinute(30) }, async (req): Promise<Wishlist> =>
    addToWishlist(db, billing, req.auth.user, req.params.productId))
  app.delete<{ Params: { productId: string } }>('/billing/wishlist/:productId', { config: perMinute(30) }, async (req): Promise<Wishlist> =>
    removeFromWishlist(db, billing, req.auth.user, req.params.productId))
  app.get<{ Params: { id: string } }>('/users/:id/wishlist', { config: perMinute(60) }, async (req): Promise<Wishlist> =>
    friendWishlist(db, billing, req.auth.user.id, idParam(req.params.id)))

  // ---- try-on in a call ----
  app.post('/billing/try-on', { config: perMinute(30) }, async (req, reply): Promise<TryOn> => {
    const { productId } = parse(TryOnBody, req.body)
    if (ageBracketOf(req.auth.user) === 'teen') throw forbidden('O provador na chamada é para maiores de 18 anos.')
    const res = await billing.tryOns.start(req.auth.user.id, productId)
    reply.code(201)
    return res
  })
  app.delete('/billing/try-on', async (req, reply) => {
    await billing.tryOns.end(req.auth.user.id)
    return reply.code(204).send()
  })

  // ---- Casa ----
  app.get<{ Params: { id: string } }>('/spaces/:id/upgrade', async (req): Promise<SpaceUpgrade> =>
    spaceUpgradeView(db, idParam(req.params.id), req.auth.user.id, config.billing.casaCinema))
  app.post<{ Params: { id: string } }>('/spaces/:id/upgrade/contributions', { config: perHour(10) }, async (req, reply): Promise<CheckoutResponse> => {
    const spaceId = idParam(req.params.id)
    const body = parse(SpaceContributionBody, req.body)
    requireAdultBuyer(req.auth.user, config, 'contribuir com a Casa')
    await requireSpace(db, spaceId, req.auth.user.id)
    const res = await billing.contribute(req.auth.user, spaceId, body.productId, body.showOnWall)
    reply.code(201)
    return res
  })
  app.patch<{ Params: { id: string } }>('/spaces/:id/upgrade', { config: perMinute(10) }, async (req): Promise<SpaceUpgrade> => {
    const spaceId = idParam(req.params.id)
    await patchSpaceUpgrade(db, spaceId, req.auth.user.id, parse(PatchSpaceUpgradeBody, req.body))
    await billing.spaceChanged(spaceId)
    return spaceUpgradeView(db, spaceId, req.auth.user.id, config.billing.casaCinema)
  })
}
