import { CallQualityReport } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { forbidden, parse } from '../errors.js'

export function telemetryRoutes(app: FastifyInstance, { telemetry }: Ctx): void {
  // Opt-in checked before the body is even parsed: without consent nothing is looked at.
  app.post('/telemetry/call-quality', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!req.auth.user.telemetryOptIn) throw forbidden('Ative o envio de diagnósticos de chamada nas configurações.')
    await telemetry.record(req.auth.user.id, parse(CallQualityReport, req.body))
    return reply.code(204).send()
  })
}
