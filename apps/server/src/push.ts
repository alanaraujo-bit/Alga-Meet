/**
 * Web Push to the PWA (contract: packages/shared/src/push.ts). Only a DM, an @mention or a call ring, never into a
 * silenced conversation, and never while the person used Alga on any device in the last PUSH_ACTIVE_MS (the gateway's
 * `active` frame). Sends are fire-and-forget: a slow or failing push service never delays the message or the call.
 */
import { PUSH_ACTIVE_MS, silencedFor, type NotifyPrefs, type PushPayload } from '@alga/shared'
import { eq, inArray } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import webpush from 'web-push'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import { notifyPrefs, pushSubscriptions, spaces, users } from './db/schema.js'

const BODY_MAX = 140
const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi
/** How long a push service keeps an undelivered push: a ring is useless after a minute, a message keeps for a day. */
const TTL = { ring: 60, message: 24 * 3600 } as const

export interface PushMessage {
  channelId: string
  channelType: 'text' | 'voice' | 'dm' | 'group_dm'
  channelName: string
  spaceId: string | null
  authorId: string
  authorName: string
  content: string
  attachments: number
}

/** Who gets a push for a message (before silences and activity): everyone else in a DM, the mentioned in a space. */
export function messageTargets(m: Pick<PushMessage, 'channelType' | 'authorId'>, audience: string[], mentioned: string[]): string[] {
  const dm = m.channelType === 'dm' || m.channelType === 'group_dm'
  return (dm ? audience : mentioned).filter((id) => id !== m.authorId)
}

/** The notification's text: "Ana" / "olha isso" for a DM, "Ana em #geral · Os de Sempre" for a mention. */
export function messagePayload(m: PushMessage, spaceName: string | null, names: Map<string, string> = new Map()): PushPayload {
  const dm = m.channelType === 'dm' || m.channelType === 'group_dm'
  // Mentions read as "@Bia", like in the app, never as the raw <@id> markup.
  const text = m.content.replace(MENTION, (_, id: string) => `@${names.get(id.toLowerCase()) ?? 'alguém'}`).trim().replace(/\s+/g, ' ')
  const body = text ? (text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text) : m.attachments ? 'Enviou um anexo' : ''
  const where = m.channelType === 'group_dm' ? (m.channelName || 'grupo') : `#${m.channelName}${spaceName ? ` · ${spaceName}` : ''}`
  return {
    kind: dm ? 'dm' : 'mention',
    title: dm && m.channelType === 'dm' ? m.authorName : `${m.authorName} em ${where}`,
    body,
    tag: `msg:${m.channelId}`,
    channelId: m.channelId,
    url: `/?channel=${m.channelId}`,
  }
}

export class Push {
  /** Last `active` frame per user (epoch ms), in memory: one API replica. */
  private readonly active = new Map<string, number>()
  readonly publicKey: string | null

  constructor(
    config: Config,
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {
    this.publicKey = config.webPush?.publicKey ?? null
    if (config.webPush) webpush.setVapidDetails(config.webPush.subject, config.webPush.publicKey, config.webPush.privateKey)
    setInterval(() => this.sweep(), PUSH_ACTIVE_MS).unref()
  }

  get enabled(): boolean {
    return this.publicKey !== null
  }

  markActive(userId: string, now = Date.now()): void {
    this.active.set(userId, now)
  }

  isActive(userId: string, now = Date.now()): boolean {
    return now - (this.active.get(userId) ?? 0) < PUSH_ACTIVE_MS
  }

  /** Drops stale activity entries (call periodically). */
  sweep(now = Date.now()): void {
    for (const [id, at] of this.active) if (now - at >= PUSH_ACTIVE_MS) this.active.delete(id)
  }

  message(m: PushMessage, audience: string[], mentioned: string[]): void {
    if (!this.enabled) return
    const targets = messageTargets(m, audience, mentioned)
    if (targets.length === 0) return
    void (async () => {
      const space = m.spaceId ? (await this.db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, m.spaceId)))[0] : undefined
      const ids = [...new Set([...m.content.matchAll(MENTION)].map((x) => x[1]!.toLowerCase()))].slice(0, 20)
      const named = ids.length ? await this.db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(inArray(users.id, ids)) : []
      const names = new Map(named.map((u) => [u.id, u.displayName || u.username]))
      await this.deliver(targets, m.channelId, m.spaceId, messagePayload(m, space?.name ?? null, names), TTL.message)
    })().catch((err: Error) => this.log.warn({ err: err.message }, 'push: message failed'))
  }

  ring(recipientIds: string[], channelId: string, fromUserId: string): void {
    if (!this.enabled || recipientIds.length === 0) return
    void (async () => {
      const [from] = await this.db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, fromUserId))
      const title = from?.displayName || from?.username || 'Alguém'
      const payload: PushPayload = { kind: 'ring', title, body: 'Te chamando para uma chamada', tag: `call:${channelId}`, channelId, url: `/?channel=${channelId}` }
      await this.deliver(recipientIds, channelId, null, payload, TTL.ring)
    })().catch((err: Error) => this.log.warn({ err: err.message }, 'push: ring failed'))
  }

  private async deliver(userIds: string[], channelId: string, spaceId: string | null, payload: PushPayload, ttl: number): Promise<void> {
    const now = Date.now()
    const awake = userIds.filter((id) => !this.isActive(id, now))
    if (awake.length === 0) return
    const prefs = new Map((await this.db.select().from(notifyPrefs).where(inArray(notifyPrefs.userId, awake))).map((r) => [r.userId, r.prefs as NotifyPrefs]))
    const to = awake.filter((id) => !(prefs.has(id) && silencedFor(prefs.get(id)!, channelId, spaceId, now)))
    if (to.length === 0) return
    const subs = await this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, to))
    this.log.info({ kind: payload.kind, targets: userIds.length, awake: awake.length, notSilenced: to.length, browsers: subs.length }, 'push: delivering')
    const body = JSON.stringify(payload)
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: ttl, urgency: 'high', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) })
          await this.db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.endpoint, s.endpoint))
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // Gone: the browser unsubscribed or the app was uninstalled.
          if (status === 404 || status === 410) await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint))
          else this.log.warn({ status, err: (err as Error).message }, 'push: send failed')
        }
      }),
    )
  }
}
