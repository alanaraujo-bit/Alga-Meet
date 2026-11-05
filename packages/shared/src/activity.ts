import { z } from 'zod'

/**
 * Rich presence ("Atividade"): what someone is doing right now, detected on their desktop (apps/desktop/src/main/
 * activity) and shared with friends and co-members only while they are visible. It names the app, never a window
 * title or a file. Sent with the `activity` gateway op; seen in Presence.activity (READY, PRESENCE_UPDATE).
 */
export const ACTIVITY_KINDS = ['game', 'code', 'creative', 'music', 'video', 'app'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const ACTIVITY_NAME_MAX = 64
/** Icon = a PNG data URL of at most this many characters (a 64×64 app icon is ~4–9 KB). */
export const ACTIVITY_ICON_MAX = 12_000
/** startedAt older than this is clamped (a timer of days reads as a bug, not as dedication). */
export const ACTIVITY_MAX_AGE_MS = 7 * 24 * 3600_000

const ICON_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
// No control/format characters (bidi overrides could spoof the surrounding UI).
const NAME_RE = /^[^\p{Cc}\p{Cf}]+$/u

export const ActivitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  /** Display name: "VALORANT", "Visual Studio Code". */
  name: z.string().trim().min(1).max(ACTIVITY_NAME_MAX).regex(NAME_RE),
  /** When it started (epoch ms): the live elapsed timer. */
  startedAt: z.number().int().positive(),
  /** App icon as a PNG data URL. Omitted when unknown (clients draw the kind's glyph). */
  icon: z.string().max(ACTIVITY_ICON_MAX).regex(ICON_RE).optional(),
  /** Steam app id of a Steam install: clients may show its store art. */
  steamAppId: z.number().int().positive().max(2_147_483_647).optional(),
})
export type Activity = z.infer<typeof ActivitySchema>

/** Server-side normalization: startedAt is the sender's clock, so keep it within [now - max age, now]. */
export function clampActivity(a: Activity, now = Date.now()): Activity {
  return { ...a, startedAt: Math.min(now, Math.max(now - ACTIVITY_MAX_AGE_MS, a.startedAt)) }
}

export function sameActivity(a: Activity | null | undefined, b: Activity | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.kind === b.kind && a.name === b.name && a.startedAt === b.startedAt && a.icon === b.icon && a.steamAppId === b.steamAppId
}

/**
 * Custom status ("Status personalizado"): a line and/or an emoji the person chose, optionally until expiresAt. Like
 * Discord, it lives in the presence (op `custom_status`): the client keeps it and sends it again after every READY,
 * the server holds it in memory while they are online, and nobody sees it while they are offline or invisible.
 */
export const CUSTOM_STATUS_MAX = 80
// One emoji (with skin tone / ZWJ / keycap / flag sequences), nothing else.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)(?:[\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic}|\p{Regional_Indicator})*$/u
// Text: no control characters and no bidi overrides (they could spoof the surrounding UI).
const STATUS_TEXT_RE = /^[^\p{Cc}\u202A-\u202E\u2066-\u2069]*$/u

export const CustomStatusSchema = z
  .object({
    text: z.string().trim().max(CUSTOM_STATUS_MAX).regex(STATUS_TEXT_RE),
    emoji: z.string().max(32).regex(EMOJI_RE).optional(),
    /** Epoch ms; omitted = until they clear it. */
    expiresAt: z.number().int().positive().optional(),
  })
  .refine((s) => s.text.length > 0 || !!s.emoji, 'text or emoji')
export type CustomStatus = z.infer<typeof CustomStatusSchema>

export const liveStatus = (s: CustomStatus | null | undefined, now = Date.now()): CustomStatus | undefined =>
  s && (!s.expiresAt || s.expiresAt > now) ? s : undefined
