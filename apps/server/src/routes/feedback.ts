import { UninstallFeedbackBody, uuidv7 } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { uninstallFeedback } from '../db/schema.js'
import { parse } from '../errors.js'

export function feedbackPublicRoutes(app: FastifyInstance, { db }: Ctx): void {
  // The uninstall window has no session: anonymous on purpose (nothing about the person or the request is stored).
  // The per-IP limit only keeps the table from being flooded.
  app.post('/feedback/uninstall', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = parse(UninstallFeedbackBody, req.body)
    await db.insert(uninstallFeedback).values({ id: uuidv7(), reason: body.reason, note: body.note || null, appVersion: body.version ?? null })
    return reply.code(204).send()
  })
}
