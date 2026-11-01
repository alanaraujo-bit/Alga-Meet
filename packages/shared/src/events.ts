import { z } from 'zod'
import type { PublicUser } from './models.js'

/**
 * Retention contract (docs/business/growth-plan.md §4, package D): space events with RSVP and reminders, the weekly
 * recap, "Semanas juntos", the activity settings (two privacy switches + the activity e-mail consent), what the desktop
 * needs to cap the "entrou na voz" notice, and the shop-open ping. Routes are listed in api.ts, dispatches in
 * gateway.ts. Server: apps/server/src/{events,activity}/; decisions and evidence: docs/retention/server.md.
 */

/** Every event date and time is wall time in this zone, whatever the computer's own zone is. */
export const EVENT_TIME_ZONE = 'America/Sao_Paulo'

// ---- wall-time helpers (shared so the desktop shows the same occurrences the server reminds about) -----------------

/** 'YYYY-MM-DDTHH:MM', wall time in EVENT_TIME_ZONE (no offset). */
export const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

const formats = new Map<string, Intl.DateTimeFormat>()
/** [year, month, day, hour, minute, second] of `instant` (ms) in `timeZone`. */
function wallParts(instant: number, timeZone: string): number[] {
  let f = formats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    formats.set(timeZone, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(instant)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return [o.year!, o.month!, o.day!, o.hour!, o.minute!, o.second!]
}

/** UTC offset (ms) of `timeZone` at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const [y, mo, d, h, mi, s] = wallParts(instant, timeZone)
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!) - Math.floor(instant / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Wall time ('YYYY-MM-DDTHH:MM') → instant; null when it is not a real date. A time skipped by DST moves forward. */
export function zonedToUtc(local: string, timeZone = EVENT_TIME_ZONE): Date | null {
  const m = LOCAL_DATE_TIME_RE.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const check = new Date(wall)
  if (h > 23 || mi > 59 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  // Second pass: the offset at the first guess can differ from the one at the answer near a DST change.
  return new Date(wall - offsetAt(wall - offsetAt(wall, timeZone), timeZone))
}

/** Instant → wall time 'YYYY-MM-DDTHH:MM' in `timeZone`. */
export function utcToZoned(instant: Date | number, timeZone = EVENT_TIME_ZONE): string {
  const [y, mo, d, h, mi] = wallParts(+instant, timeZone)
  return `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${pad(mi!)}`
}

/** Calendar day 'YYYY-MM-DD' of `instant` in `timeZone`. */
export const zonedDay = (instant: Date | number, timeZone = EVENT_TIME_ZONE) => utcToZoned(instant, timeZone).slice(0, 10)

/** Same wall time `days` calendar days later. */
export function addLocalDays(local: string, days: number): string {
  const [y, mo, d, h, mi] = LOCAL_DATE_TIME_RE.exec(local)!.slice(1).map(Number) as [number, number, number, number, number]
  return new Date(Date.UTC(y, mo - 1, d + days, h, mi)).toISOString().slice(0, 16)
}

export interface EventOccurrence {
  startsAt: string
  endsAt: string
}

/** What the occurrence math needs from an event. */
export interface EventSchedule {
  startsLocal: string
  durationMinutes: number
  weekly: boolean
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Start of occurrence `k` (0 = the first): a weekly event keeps its wall time across offset changes. */
export const occurrenceStart = (ev: Pick<EventSchedule, 'startsLocal'>, k: number, timeZone = EVENT_TIME_ZONE) =>
  zonedToUtc(addLocalDays(ev.startsLocal, 7 * k), timeZone)!

/** First occurrence whose start passes `test`, scanning forward from about `from` (weekly events). */
function firstFrom(ev: EventSchedule, from: number, test: (start: number) => boolean, timeZone: string): Date | null {
  const first = zonedToUtc(ev.startsLocal, timeZone)
  if (!first) return null
  if (!ev.weekly) return test(first.getTime()) ? first : null
  // Occurrences are a week apart give or take a DST hour: start one week early and walk forward.
  for (let k = Math.max(0, Math.floor((from - first.getTime()) / WEEK_MS) - 1); ; k++) {
    const s = occurrenceStart(ev, k, timeZone)
    if (test(s.getTime())) return s
  }
}

/** The occurrence live at `now`, else the next one; null when a one-off event is over. */
export function currentOccurrence(ev: EventSchedule, now: Date | number = Date.now(), timeZone = EVENT_TIME_ZONE): EventOccurrence | null {
  const dur = ev.durationMinutes * 60_000
  const s = firstFrom(ev, +now - dur, (start) => start + dur > +now, timeZone)
  return s ? { startsAt: s.toISOString(), endsAt: new Date(s.getTime() + dur).toISOString() } : null
}

/** Start of the first occurrence strictly after `after` (what a reminder is about); null if none. */
export const nextStart = (ev: EventSchedule, after: Date | number, timeZone = EVENT_TIME_ZONE): Date | null =>
  firstFrom(ev, +after, (start) => start > +after, timeZone)

// ---- events ---------------------------------------------------------------------------------------------------------

/** Vou / Talvez / Não. */
export const RSVP_STATUSES = ['going', 'maybe', 'not_going'] as const
export type RsvpStatus = (typeof RSVP_STATUSES)[number]

export const EVENT_TEMPLATES = ['game_night', 'sunday_cinema', 'study'] as const
export type EventTemplate = (typeof EVENT_TEMPLATES)[number]

/** Preset cover art drawn by the desktop. A Casa perk: set and shown only while the space's Casa is lit. */
export const EVENT_COVERS = ['hora_azul', 'game', 'cinema', 'study'] as const
export type EventCover = (typeof EVENT_COVERS)[number]

/**
 * Form defaults per template ("Sexta do jogo", "Cinema de domingo" (a stream night), "Estudo"). The desktop pre-fills
 * the form with them (weekday: 0 = Sunday, null = any; time in EVENT_TIME_ZONE); the server stores only `template`.
 */
export const EVENT_TEMPLATE_DEFAULTS: Record<EventTemplate, {
  title: string; weekday: number | null; time: string; durationMinutes: number; weekly: boolean; cover: EventCover
}> = {
  game_night: { title: 'Sexta do jogo', weekday: 5, time: '21:00', durationMinutes: 180, weekly: true, cover: 'game' },
  sunday_cinema: { title: 'Cinema de domingo', weekday: 0, time: '20:00', durationMinutes: 150, weekly: true, cover: 'cinema' },
  study: { title: 'Estudo', weekday: null, time: '19:00', durationMinutes: 120, weekly: false, cover: 'study' },
}

export const EVENT_TITLE_MAX = 100
export const EVENT_DESCRIPTION_MAX = 1000
export const EVENT_DURATION_MIN_MINUTES = 15
export const EVENT_DURATION_MAX_MINUTES = 12 * 60
/** First occurrence at most this far ahead (and never in the past). */
export const EVENT_MAX_DAYS_AHEAD = 365
/** Events a space can hold (one-offs that are over do not count). */
export const MAX_EVENTS_PER_SPACE = 50
/** In-app reminder (EVENT_REMINDER) this long before each occurrence, to RSVP going/maybe. */
export const EVENT_REMINDER_MINUTES = 15
/** E-mail reminder this long before, only for who asked on that event (EventView.emailReminder). */
export const EVENT_EMAIL_REMINDER_MINUTES = 120

/** Same for every member (gateway). REST adds the caller's own answer (EventView). */
export interface SpaceEvent {
  id: string
  spaceId: string
  /** A voice channel of the space; null after that channel was deleted (the event stays, nowhere to "Entrar"). */
  channelId: string | null
  /** null once the creator's account is gone. */
  creatorId: string | null
  title: string
  description: string
  template: EventTemplate | null
  /** First occurrence as wall time in EVENT_TIME_ZONE; a weekly event repeats at this wall time every 7 days. */
  startsLocal: string
  /** The same moment as an instant (ISO). */
  startsAt: string
  durationMinutes: number
  weekly: boolean
  /** Only while the space's Casa is lit, else null (the choice is kept and comes back with the Casa). */
  cover: EventCover | null
  /** currentOccurrence() when the server sent it: the live one or the next; null = a one-off that is over. */
  next: EventOccurrence | null
  /** Members who answered "Vou" / "Talvez" (an answer holds for every occurrence of a weekly event). */
  going: number
  maybe: number
  createdAt: string
}

export interface EventView extends SpaceEvent {
  myRsvp: RsvpStatus | null
  /** You asked for the e-mail EVENT_EMAIL_REMINDER_MINUTES before (kept only with going/maybe). */
  emailReminder: boolean
}

/** GET /events/:id/rsvps. Who answered "Não" is never listed. */
export interface EventRsvps {
  going: PublicUser[]
  maybe: PublicUser[]
}

const localDateTime = z.string().regex(LOCAL_DATE_TIME_RE, 'Use AAAA-MM-DDTHH:MM.').refine((s) => zonedToUtc(s) !== null, 'Data inválida.')
const title = z.string().trim().min(1).max(EVENT_TITLE_MAX)
const description = z.string().trim().max(EVENT_DESCRIPTION_MAX)
const duration = z.number().int().min(EVENT_DURATION_MIN_MINUTES).max(EVENT_DURATION_MAX_MINUTES)

export const CreateEventBody = z.object({
  title,
  description: description.default(''),
  /** A voice channel of the same space. */
  channelId: z.string().uuid(),
  /** Wall time in EVENT_TIME_ZONE, from now to EVENT_MAX_DAYS_AHEAD days ahead. */
  startsLocal: localDateTime,
  durationMinutes: duration.default(120),
  weekly: z.boolean().default(false),
  template: z.enum(EVENT_TEMPLATES).nullable().default(null),
  /** Needs the Casa lit (409 otherwise). */
  cover: z.enum(EVENT_COVERS).nullable().default(null),
})
export type CreateEventBody = z.infer<typeof CreateEventBody>

/** Same rules as CreateEventBody; a new startsLocal must not be in the past. */
export const PatchEventBody = z.object({
  title: title.optional(),
  description: description.optional(),
  channelId: z.string().uuid().optional(),
  startsLocal: localDateTime.optional(),
  durationMinutes: duration.optional(),
  weekly: z.boolean().optional(),
  cover: z.enum(EVENT_COVERS).nullable().optional(),
})
export type PatchEventBody = z.infer<typeof PatchEventBody>

export const RsvpBody = z.object({
  status: z.enum(RSVP_STATUSES),
  /** Ask for the 2 h e-mail on this event (needs a verified e-mail; dropped with "Não"). Omitted = unchanged. */
  emailReminder: z.boolean().optional(),
})
export type RsvpBody = z.infer<typeof RsvpBody>

// ---- weekly recap and "Semanas juntos" ------------------------------------------------------------------------------

/** A day counts as a "noite" with this much voice. */
export const RECAP_NIGHT_MINUTES = 30
/** An event occurrence counts as attended with this much time in its channel during it. */
export const RECAP_EVENT_MINUTES = 10
/** Recaps and voice_weekly are kept this many weeks. */
export const RECAP_WEEKS_KEPT = 12

/**
 * GET /users/@me/recap. Built Monday 10:00 (EVENT_TIME_ZONE) for the week before, only from voice sessions and events:
 * never message content or counts, who spoke most, or a ranking. No recap = no voice that week.
 */
export interface WeeklyRecap {
  /** Monday 'YYYY-MM-DD' starting the week (Monday 00:00 to Sunday 24:00, EVENT_TIME_ZONE). */
  week: string
  /** Minutes in voice: space channels and DM calls. */
  voiceMinutes: number
  /** Days with RECAP_NIGHT_MINUTES+ in voice. */
  nights: number
  /** Most used space voice channel; omitted without one (or if you left that space). */
  topChannel?: { channelId: string; spaceId: string }
  /**
   * Minutes of streams watched. Not measured yet (who watches is decided in the client, the server never sees it):
   * always omitted. Kept in the type so the card can show it when it exists.
   */
  streamWatchedMinutes?: number
  /** Event occurrences you were at (RECAP_EVENT_MINUTES+ in its channel during it), in your current spaces. */
  events: { eventId: string; spaceId: string; title: string; startsAt: string }[]
  /** Up to 3 people you were in voice with the most, only among those with showInOthersRecap on. Never their time. */
  people: PublicUser[]
  /** "Semanas juntos" of your spaces where it is on and at least 1. */
  weeksTogether: { spaceId: string; weeks: number }[]
}

/** A week counts for "Semanas juntos" with one call of this many members for this long (in one voice channel). */
export const WEEKS_TOGETHER_MIN_MEMBERS = 3
export const WEEKS_TOGETHER_MIN_MINUTES = 30
/** A missed week is paused automatically once per this many counted weeks. */
export const WEEKS_TOGETHER_PAUSE_EVERY = 4

/**
 * GET /spaces/:id/weeks-together: the group's streak, shown only on hover of the space header and in the recap. No
 * notice ever comes from it (no dispatch, no e-mail, no "vai perder", no paid recovery).
 */
export interface WeeksTogether {
  spaceId: string
  /** Admins (MANAGE_SPACE) can turn it off; off = nothing is counted or shown, and it starts from 0 when turned on. */
  enabled: boolean
  weeks: number
  /** The next missed week will be paused instead of ending the streak. */
  pauseAvailable: boolean
  /** Last week (Monday) that was evaluated, or null. */
  lastWeek: string | null
}

export const PatchWeeksTogetherBody = z.object({ enabled: z.boolean() })
export type PatchWeeksTogetherBody = z.infer<typeof PatchWeeksTogetherBody>

// ---- activity settings, activity e-mail ---------------------------------------------------------------------------

/** GET/PATCH /users/@me/activity-settings. */
export interface ActivitySettings {
  /** "Aparecer no resumo dos outros" (default on). Off: you are never among anyone's 3 people. */
  showInOthersRecap: boolean
  /**
   * "Não usar minha atividade nas métricas do produto" (default off). On: your daily activity records are deleted and
   * no longer kept, and you are left out of every aggregate; your own recap keeps working.
   */
  metricsOptOut: boolean
  /** Consent to the activity e-mail (default off, an unchecked box; each change is recorded). */
  activityEmail: boolean
  /** The activity e-mail exists for you: 18+ with a verified e-mail. Hide the box otherwise (turning it on is a 403). */
  activityEmailAllowed: boolean
}

export const PatchActivitySettingsBody = z.object({
  showInOthersRecap: z.boolean().optional(),
  metricsOptOut: z.boolean().optional(),
  activityEmail: z.boolean().optional(),
})
export type PatchActivitySettingsBody = z.infer<typeof PatchActivitySettingsBody>

/** Activity e-mail caps (growth-plan §4.3), enforced by the server. */
export const ACTIVITY_EMAIL_INACTIVE_DAYS = 7
export const ACTIVITY_EMAIL_MIN_GAP_DAYS = 7
export const ACTIVITY_EMAIL_MAX_IN_60_DAYS = 4

// ---- "entrou na voz" notice (decided and capped by the desktop) ---------------------------------------------------

/** A friend joining voice notifies for scopes where you were in a call within this many days, or marked "Avisar". */
export const VOICE_NOTIFY_RECENT_DAYS = 21
/**
 * Caps the desktop applies (it alone knows "Não perturbe", full-screen games and whether you are in a call, where it
 * never notifies): one per scope every 3 h, 4 per day, nothing from 01:00 to 09:00 local time.
 */
export const VOICE_NOTICE_CAPS = { perScopeMinutes: 180, perDay: 4, quietFromHour: 1, quietUntilHour: 9 } as const

export interface VoiceNotifyScope {
  /** Space id, or channel id of a DM / group DM. */
  scopeId: string
  kind: 'space' | 'dm'
  /** End of your last call there within VOICE_NOTIFY_RECENT_DAYS (ISO), null if none. */
  lastCallAt: string | null
  /** Your choice: true = "Avisar", false = never, null = automatic (notify only while lastCallAt is set). */
  notify: boolean | null
}

/** GET /users/@me/voice-notify: every scope with a recent call or a choice. Recent calls are refreshed by refetching. */
export interface VoiceNotifyScopes {
  scopes: VoiceNotifyScope[]
}

export const PutVoiceNotifyBody = z.object({ notify: z.boolean().nullable() })
export type PutVoiceNotifyBody = z.infer<typeof PutVoiceNotifyBody>

// ---- shop funnel ----------------------------------------------------------------------------------------------------

/**
 * POST /shop/opened: the desktop says the shop was opened (a counter with fixed labels; nothing about the user is
 * stored). Try-ons and checkouts are counted by the server itself.
 */
export const SHOP_FUNNEL_STEPS = ['shop_open', 'try_on', 'checkout', 'gift_checkout'] as const
export type ShopFunnelStep = (typeof SHOP_FUNNEL_STEPS)[number]
