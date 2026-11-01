import { CheckoutBody, type BillingCatalog, type BillingMe, type CheckoutResponse, type Subscription } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { requireVerifiedEmail } from '../auth.js'
import { ageBracketOf } from '../legal.js'
import { WebhookRejected } from '../billing/provider.js'
import { HttpError, forbidden, idParam, parse } from '../errors.js'
import { metrics } from '../metrics.js'
import { perMinute } from './users.js'

/** Catalog, provider webhooks (encapsulated raw-body parser) and the sandbox's fake payment page. */
export async function billingPublicRoutes(app: FastifyInstance, { billing }: Ctx): Promise<void> {
  app.get('/billing/catalog', async (): Promise<BillingCatalog> => billing.catalog())

  await app.register(async (hook) => {
    // Raw text: the sandbox signs the exact bytes; Mercado Pago's body is only read for the event id and type.
    hook.removeContentTypeParser('application/json')
    hook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body))
    // Server-to-server and signature-checked; generous ceiling per IP because providers retry in bursts.
    hook.post<{ Params: { provider: string } }>('/billing/webhooks/:provider', { config: perMinute(600) }, async (req) => {
      const provider = ['sandbox', 'mercadopago'].includes(req.params.provider) ? req.params.provider : 'other'
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

export function billingRoutes(app: FastifyInstance, { billing, config }: Ctx): void {
  app.get('/billing/me', async (req): Promise<BillingMe> => billing.me(req.auth.user))

  app.post('/billing/checkout', { config: perMinute(10) }, async (req, reply): Promise<CheckoutResponse> => {
    const { productId } = parse(CheckoutBody, req.body)
    requireVerifiedEmail(req.auth.user, 'fazer compras')
    // Código Civil art. 4º: 16-17 are relatively incapable; until a guardian flow exists, purchases are 18+ only.
    const age = ageBracketOf(req.auth.user)
    if (age === 'teen') throw forbidden('Compras no Alga Meet exigem 18 anos ou mais.')
    if (age === 'unknown' && config.legal.requireBirthDate) throw forbidden('Informe sua data de nascimento antes de comprar.')
    const res = await billing.checkout(req.auth.user, productId)
    reply.code(201)
    return res
  })

  app.post('/billing/subscription/cancel', { config: perMinute(10) }, async (req): Promise<Subscription> => billing.cancel(req.auth.user.id))
  app.post('/billing/subscription/resume', { config: perMinute(10) }, async (req): Promise<Subscription> => billing.resume(req.auth.user.id))
}
