import { CheckoutBody, type BillingCatalog, type BillingMe, type CheckoutResponse, type Subscription } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { requireVerifiedEmail } from '../auth.js'
import { WebhookRejected } from '../billing/provider.js'
import { HttpError, idParam, parse } from '../errors.js'
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
      try {
        await billing.handleWebhook(req.params.provider, {
          rawBody: typeof req.body === 'string' ? req.body : '',
          headers: req.headers,
          query: req.query as Record<string, unknown>,
        })
      } catch (err) {
        if (!(err instanceof WebhookRejected)) throw err
        req.log.warn({ provider: req.params.provider, reason: err.message }, 'billing webhook rejected')
        throw new HttpError('unauthorized', 'Assinatura do webhook inválida.')
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

export function billingRoutes(app: FastifyInstance, { billing }: Ctx): void {
  app.get('/billing/me', async (req): Promise<BillingMe> => billing.me(req.auth.user))

  app.post('/billing/checkout', { config: perMinute(10) }, async (req, reply): Promise<CheckoutResponse> => {
    const { productId } = parse(CheckoutBody, req.body)
    requireVerifiedEmail(req.auth.user, 'fazer compras')
    const res = await billing.checkout(req.auth.user, productId)
    reply.code(201)
    return res
  })

  app.post('/billing/subscription/cancel', { config: perMinute(10) }, async (req): Promise<Subscription> => billing.cancel(req.auth.user.id))
}
