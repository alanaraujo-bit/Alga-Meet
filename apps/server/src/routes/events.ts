/** Space events and RSVP (src/events/events.ts; contract in packages/shared/src/events.ts and api.ts). */
import { CreateEventBody, PatchEventBody, Permission, RsvpBody, type EventRsvps, type EventView } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import { requireSpace } from '../access.js'
import type { Ctx } from '../app.js'
import { idParam, parse } from '../errors.js'
import { perMinute } from './users.js'

type Id = { Params: { id: string } }

export function eventRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, events } = ctx

  app.get('/events', { config: perMinute(60) }, async (req): Promise<EventView[]> => events.list(req.auth.user.id))

  app.get<Id>('/spaces/:id/events', { config: perMinute(60) }, async (req): Promise<EventView[]> => {
    const spaceId = idParam(req.params.id)
    await requireSpace(db, spaceId, req.auth.user.id, Permission.VIEW_CHANNELS)
    return events.list(req.auth.user.id, spaceId)
  })

  app.post<Id>('/spaces/:id/events', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply): Promise<EventView> => {
    const spaceId = idParam(req.params.id)
    await requireSpace(db, spaceId, req.auth.user.id, Permission.VIEW_CHANNELS | Permission.CREATE_EVENTS)
    const view = await events.create(spaceId, req.auth.user.id, parse(CreateEventBody, req.body))
    reply.code(201)
    return view
  })

  app.patch<Id>('/events/:id', { config: perMinute(30) }, async (req): Promise<EventView> =>
    events.patch(idParam(req.params.id), req.auth.user.id, parse(PatchEventBody, req.body)))

  app.delete<Id>('/events/:id', { config: perMinute(30) }, async (req, reply) => {
    await events.remove(idParam(req.params.id), req.auth.user.id)
    return reply.code(204).send()
  })

  app.put<Id>('/events/:id/rsvp', { config: perMinute(30) }, async (req): Promise<EventView> =>
    events.rsvp(idParam(req.params.id), req.auth.user, parse(RsvpBody, req.body)))

  app.delete<Id>('/events/:id/rsvp', { config: perMinute(30) }, async (req): Promise<EventView> =>
    events.rsvp(idParam(req.params.id), req.auth.user, null))

  app.get<Id>('/events/:id/rsvps', { config: perMinute(60) }, async (req): Promise<EventRsvps> =>
    events.rsvps(idParam(req.params.id), req.auth.user.id))
}
