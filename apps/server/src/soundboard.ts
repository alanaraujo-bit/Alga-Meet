/**
 * Soundboard anti-spam (spec §5.3): per person, the next play waits for the end of their sound + SOUND_COOLDOWN_MS and
 * at most PLAYS_PER_MINUTE per minute; per channel, at most CHANNEL_MAX_CONCURRENT sounds at once.
 * shortcut: in memory, one API instance only; move to Redis together with @fastify/rate-limit when there are several.
 */
import { CHANNEL_MAX_CONCURRENT, PLAYS_PER_MINUTE, SOUND_COOLDOWN_MS, type SoundboardLimitReason } from '@alga/shared'

const MINUTE = 60_000

export type PlayVerdict = { ok: true } | { ok: false; retryAfterMs: number; reason: SoundboardLimitReason }

export class SoundboardLimiter {
  /** userId → when they may play again, and their play times in the last minute. */
  private users = new Map<string, { nextAt: number; plays: number[] }>()
  /** channelId → end times of the sounds playing now. */
  private channels = new Map<string, number[]>()
  private sweptAt = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** Checks and, when allowed, records in the same synchronous call, so concurrent requests cannot both pass. */
  tryPlay(userId: string, channelId: string, durationMs: number): PlayVerdict {
    const now = this.now()
    if (now - this.sweptAt >= MINUTE) this.sweep(now)
    const user = this.users.get(userId)
    if (user && user.nextAt > now) return { ok: false, reason: 'cooldown', retryAfterMs: user.nextAt - now }
    const recent = user?.plays.filter((t) => t > now - MINUTE) ?? []
    if (recent.length >= PLAYS_PER_MINUTE) return { ok: false, reason: 'burst', retryAfterMs: recent[0]! + MINUTE - now }
    const playing = (this.channels.get(channelId) ?? []).filter((end) => end > now)
    if (playing.length >= CHANNEL_MAX_CONCURRENT) {
      return { ok: false, reason: 'channel_busy', retryAfterMs: Math.min(...playing) - now }
    }
    this.users.set(userId, { nextAt: now + durationMs + SOUND_COOLDOWN_MS, plays: [...recent, now] })
    this.channels.set(channelId, [...playing, now + durationMs])
    return { ok: true }
  }

  /** Tracked users + channels (tests and metrics). */
  size(): number {
    return this.users.size + this.channels.size
  }

  private sweep(now: number): void {
    this.sweptAt = now
    for (const [id, u] of this.users) if (u.nextAt <= now && u.plays.every((t) => t <= now - MINUTE)) this.users.delete(id)
    for (const [id, ends] of this.channels) if (ends.every((end) => end <= now)) this.channels.delete(id)
  }
}
