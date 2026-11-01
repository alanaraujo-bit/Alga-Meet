import { Permission, VoiceJoinBody, hasPermission, type VoiceJoinResponse } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import { NO_MODERATION, assertDmNotBlocked, requireChannel, voiceModeration } from '../access.js'
import type { Ctx } from '../app.js'
import { HttpError, badRequest, forbidden, parse } from '../errors.js'
import { PLANS } from '../billing/catalog.js'
import { metrics } from '../metrics.js'
import { roomName } from '../voice.js'

export function voiceRoutes(app: FastifyInstance, { db, voice, config }: Ctx): void {
  app.post('/voice/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req): Promise<VoiceJoinResponse> => {
    const { channelId } = parse(VoiceJoinBody, req.body)
    const me = req.auth.user
    const access = await requireChannel(db, channelId, me.id, Permission.CONNECT)
    const { channel, permissions } = access
    if (channel.type === 'text') throw badRequest('Canais de texto não têm voz.')
    await assertDmNotBlocked(db, access, me.id)
    const limit = channel.userLimit ?? 0
    if (limit > 0 && !hasPermission(permissions, Permission.MOVE_MEMBERS) && !voice.hasMoveTicket(me.id, channel.id)) {
      const others = voice.inChannel(channel.id).filter((s) => s.userId !== me.id).length
      if (others >= limit) throw forbidden('Este canal de voz está cheio.')
    }
    const streamPresets = [...PLANS[me.plan].streamPresets]
    const token = await voice.mintToken(me, channel.id, permissions,
      channel.spaceId ? await voiceModeration(db, channel.spaceId, me.id) : NO_MODERATION, streamPresets)
    metrics.voiceTokens.inc({ kind: channel.spaceId ? 'space' : 'private' })
    return {
      url: config.livekit.publicUrl,
      token,
      room: roomName(channel.id),
      bitrateKbps: channel.bitrateKbps ?? 64,
      streamPresets,
    }
  })
}

/** LiveKit's webhook event names (metric label values; anything else counts as "other"). */
const LIVEKIT_EVENTS = new Set([
  'room_started', 'room_finished', 'participant_joined', 'participant_left', 'participant_connection_aborted',
  'track_published', 'track_unpublished', 'egress_started', 'egress_updated', 'egress_ended', 'ingress_started', 'ingress_ended',
])

/** LiveKit → server. Encapsulated so its raw-body content-type parser does not leak to other routes. */
export async function livekitWebhookRoute(app: FastifyInstance, { voice }: Ctx): Promise<void> {
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/webhook+json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, body, done) => {
      done(null, body)
    })
    // Server-to-server and signature-checked; LiveKit bursts many events from one IP.
    hook.post('/livekit/webhook', { config: { rateLimit: false } }, async (req) => {
      if (typeof req.body !== 'string') throw badRequest('Content-Type esperado: application/webhook+json.')
      let event
      try {
        event = await voice.receive(req.body, req.headers.authorization)
      } catch (err) {
        metrics.livekitWebhookFailures.inc({ reason: 'signature' })
        req.log.warn({ reason: (err as Error).message }, 'livekit webhook rejected')
        throw new HttpError('unauthorized', 'Assinatura do webhook inválida.')
      }
      req.log.info({ event: event.event, room: event.room?.name, participant: event.participant?.identity }, 'livekit webhook')
      const stop = metrics.livekitWebhookDuration.start({ event: LIVEKIT_EVENTS.has(event.event) ? event.event : 'other' })
      try {
        await voice.handleEvent(event)
      } catch (err) {
        metrics.livekitWebhookFailures.inc({ reason: 'handler' })
        throw err
      } finally {
        stop()
      }
      return { ok: true }
    })
  })
}
