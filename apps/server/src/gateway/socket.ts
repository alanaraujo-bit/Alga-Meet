import { GatewayClose, type ClientFrame, type ReadyPayload } from '@alga/shared'
import { eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { z } from 'zod'
import { presenceAudience } from '../access.js'
import type { Ctx } from '../app.js'
import { resolveToken } from '../auth.js'
import { safeErr } from '../errors.js'
import { readStates, spaceMembers, users, type UserRow } from '../db/schema.js'
import { afterMeUpdate } from '../routes/users.js'
import { meView, privateChannelsOf, publicUser, relationshipsOf, spaceSnapshots } from '../views.js'
import { Throttle, broadcastPresence, effectiveStatus, type Conn } from './hub.js'

/** Discord's gateway figure. Also bounds the per-socket frame queue (each frame ≤ 16 KiB). */
const FRAME_LIMIT = 120
const FRAME_WINDOW_MS = 60_000
const MAX_SOCKETS_PER_USER = 10
const IDENTIFY_TIMEOUT_MS = 10_000
/** presence / voice_state fan-out per user (latest value wins). */
const STATE_OP_INTERVAL_MS = 1_000
/** A client that does not read (zero TCP window) is dropped instead of buffering without bound. */
const MAX_BUFFERED_BYTES = 1024 * 1024

const ClientFrameSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('identify'), token: z.string().min(1).max(256) }),
  z.object({ op: z.literal('heartbeat') }),
  z.object({ op: z.literal('presence'), status: z.enum(['online', 'idle', 'dnd', 'invisible']) }),
  z.object({
    op: z.literal('voice_state'),
    selfMute: z.boolean(), selfDeaf: z.boolean(), streaming: z.boolean(), video: z.boolean(),
  }),
]) satisfies z.ZodType<ClientFrame>

export async function buildReady(ctx: Ctx, user: UserRow): Promise<ReadyPayload> {
  const { db, voice, hub, config } = ctx
  const memberships = await db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, user.id))
  const spaceIds = memberships.map((m) => m.id)
  const [spaces, privateChannels, relationships, reads, audience] = await Promise.all([
    spaceSnapshots(db, spaceIds),
    privateChannelsOf(db, user.id),
    relationshipsOf(db, user.id),
    db.select().from(readStates).where(eq(readStates.userId, user.id)),
    presenceAudience(db, user.id),
  ])

  const memberIds = new Set(spaces.flatMap((s) => s.members.map((m) => m.user.id)))
  const strangerIds = [...new Set(privateChannels.flatMap((c) => c.recipientIds ?? []))]
    .filter((id) => id !== user.id && !memberIds.has(id))
  const [prefRows, strangers] = await Promise.all([
    audience.length ? db.select({ id: users.id, pref: users.statusPreference }).from(users).where(inArray(users.id, audience)) : [],
    strangerIds.length ? db.select().from(users).where(inArray(users.id, strangerIds)) : [],
  ])

  const spaceSet = new Set(spaceIds)
  const privateSet = new Set(privateChannels.map((c) => c.id))
  return {
    user: meView(user),
    spaces,
    privateChannels,
    relationships,
    // Only non-offline presences are sent; clients default everyone else to offline.
    presences: prefRows
      .map((r) => ({ userId: r.id, status: effectiveStatus(r.pref, hub.isOnline(r.id)) }))
      .filter((p) => p.status !== 'offline'),
    voiceStates: voice.all().filter((s) => (s.spaceId ? spaceSet.has(s.spaceId) : privateSet.has(s.channelId))),
    readStates: reads.map((r) => ({ channelId: r.channelId, lastReadMessageId: r.lastReadMessageId, mentionCount: r.mentionCount })),
    users: strangers.map(publicUser),
    heartbeatIntervalMs: config.heartbeatIntervalMs,
  }
}

export function gatewayRoute(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, voice, config } = ctx
  const stateOps = new Throttle(STATE_OP_INTERVAL_MS, (err) => ctx.log.error({ err: safeErr(err) }, 'gateway state op failed'))
  const prune = setInterval(() => stateOps.prune(), 60_000)
  prune.unref()
  app.addHook('onClose', async () => {
    clearInterval(prune)
    stateOps.prune(true)
  })

  app.get('/gateway', { websocket: true }, (socket: WebSocket, req) => {
    const log = req.log
    let conn: Conn | null = null
    let ready = false
    const backlog: string[] = []
    let timer: NodeJS.Timeout | undefined
    let chain = Promise.resolve()
    let windowStart = Date.now()
    let frames = 0

    const close = (code: number, reason: string) => {
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, reason)
    }
    // No frame (identify or heartbeat) for two intervals → the connection is considered dead.
    const arm = (ms = config.heartbeatIntervalMs * 2) => {
      clearTimeout(timer)
      timer = setTimeout(() => close(GatewayClose.HEARTBEAT_TIMEOUT, 'heartbeat timeout'), ms)
    }
    arm(Math.min(IDENTIFY_TIMEOUT_MS, config.heartbeatIntervalMs * 2))

    const handle = async (raw: string) => {
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        return close(GatewayClose.INVALID_PAYLOAD, 'invalid json')
      }
      const parsed = ClientFrameSchema.safeParse(json)
      if (!parsed.success) return close(GatewayClose.INVALID_PAYLOAD, 'invalid frame')
      const frame = parsed.data

      if (frame.op === 'identify') {
        if (conn) return close(GatewayClose.INVALID_PAYLOAD, 'already identified')
        const auth = await resolveToken(db, frame.token)
        if (!auth) return close(GatewayClose.AUTH_FAILED, 'authentication failed')
        if (socket.readyState !== socket.OPEN) return
        if (hub.connections(auth.user.id) >= MAX_SOCKETS_PER_USER) return close(GatewayClose.RATE_LIMITED, 'too many connections')
        arm()
        // Registered before READY is built so nothing dispatched meanwhile is lost; it is flushed after READY.
        conn = {
          userId: auth.user.id,
          sessionId: auth.sessionId,
          send: (data) => {
            if (!ready) return void backlog.push(data)
            if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return socket.terminate()
            socket.send(data)
          },
          close,
        }
        const cameOnline = hub.add(conn)
        const payload = await buildReady(ctx, auth.user)
        if (socket.readyState !== socket.OPEN) return
        socket.send(JSON.stringify({ op: 'dispatch', t: 'READY', d: payload }))
        ready = true
        for (const data of backlog.splice(0)) socket.send(data)
        const status = effectiveStatus(auth.user.statusPreference, true)
        if (cameOnline && status !== 'offline') await broadcastPresence(db, hub, auth.user.id, status)
        return
      }

      if (!conn) return close(GatewayClose.INVALID_PAYLOAD, 'identify first')
      arm()
      const userId = conn.userId

      switch (frame.op) {
        case 'heartbeat':
          socket.send(JSON.stringify({ op: 'heartbeat_ack' }))
          break
        case 'presence':
          await stateOps.run(`presence:${userId}`, async () => {
            const [before] = await db.select().from(users).where(eq(users.id, userId))
            if (!before || before.statusPreference === frame.status) return
            const [after] = await db.update(users).set({ statusPreference: frame.status }).where(eq(users.id, userId)).returning()
            await afterMeUpdate(ctx, before, after!)
          })
          break
        case 'voice_state':
          await stateOps.run(`voice:${userId}`, () => voice.updateSelf(userId, {
            selfMute: frame.selfMute, selfDeaf: frame.selfDeaf, streaming: frame.streaming, video: frame.video,
          }))
          break
      }
    }

    socket.on('message', (data, isBinary) => {
      const now = Date.now()
      if (now - windowStart >= FRAME_WINDOW_MS) {
        windowStart = now
        frames = 0
      }
      if (++frames > FRAME_LIMIT) return close(GatewayClose.RATE_LIMITED, 'rate limited')
      const raw = isBinary ? '' : data.toString()
      chain = chain.then(() => handle(raw)).catch((err: unknown) => {
        log.error({ err: safeErr(err) }, 'gateway frame handling failed')
        close(1011, 'internal error')
      })
    })

    socket.on('close', () => {
      clearTimeout(timer)
      const c = conn
      conn = null
      if (c && hub.remove(c) && !hub.closing) {
        broadcastPresence(db, hub, c.userId, 'offline').catch((err: unknown) => log.error({ err: safeErr(err) }, 'presence broadcast failed'))
      }
    })

    socket.on('error', (err) => log.warn({ err: err.message }, 'gateway socket error'))
  })
}
