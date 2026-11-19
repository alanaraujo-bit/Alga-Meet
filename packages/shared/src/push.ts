/**
 * Web Push (the PWA) and the notification choices every device shares.
 *
 * GET    /push/key                 -> PushKey               (VAPID public key; `key: null` when push is off on this server)
 * POST   /push/subscriptions       PushSubscribeBody     -> 204   (this browser's PushSubscription; upsert by endpoint)
 * DELETE /push/subscriptions       PushUnsubscribeBody   -> 204
 * GET    /users/@me/notify-prefs                        -> NotifyPrefs
 * PUT    /users/@me/notify-prefs   NotifyPrefs           -> NotifyPrefs  (whole document; NOTIFY_PREFS_UPDATE to my other devices)
 *
 * A push goes to someone only for a DM, an @mention or a call ring, never while they used Alga in the last
 * PUSH_ACTIVE_MS on any device (gateway `active` frame), and never into a silenced DM, channel or space.
 */
import { z } from 'zod'

export const PUSH_ACTIVE_MS = 2 * 60_000

export interface PushKey {
  key: string | null
}

export const PushSubscribeBody = z.object({
  endpoint: z.string().url().max(2048).refine((u) => u.startsWith('https://'), 'https only'),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
})
export type PushSubscribeBody = z.infer<typeof PushSubscribeBody>

export const PushUnsubscribeBody = z.object({ endpoint: z.string().url().max(2048) })
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBody>

/** What a push carries (encrypted to the browser by the Web Push standard). `url`: where a tap opens the PWA. */
export interface PushPayload {
  kind: 'dm' | 'mention' | 'ring'
  title: string
  body: string
  /** Notifications with the same tag replace each other (one per conversation). */
  tag: string
  channelId: string
  url: string
}

export const NOTIFY_LEVELS = ['all', 'mentions', 'none'] as const
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number]

const id = z.string().uuid()
/**
 * The app's "Notificações" choices (features/app/notifyPrefs.ts): `levels` per space; `muted` per space, channel or DM,
 * epoch ms until when (a far-future value = until turned back on).
 */
export const NotifyPrefs = z.object({
  levels: z.record(id, z.enum(NOTIFY_LEVELS)).refine((r) => Object.keys(r).length <= 500, 'too many'),
  muted: z.record(id, z.number().int().nonnegative()).refine((r) => Object.keys(r).length <= 1000, 'too many'),
})
export type NotifyPrefs = z.infer<typeof NotifyPrefs>

/** Silenced: the DM or channel itself, its space, or the space's level "none". `spaceId` null for DMs. */
export function silencedFor(prefs: NotifyPrefs, channelId: string, spaceId: string | null, now = Date.now()): boolean {
  if ((prefs.muted[channelId] ?? 0) > now) return true
  if (!spaceId) return false
  return (prefs.muted[spaceId] ?? 0) > now || prefs.levels[spaceId] === 'none'
}
