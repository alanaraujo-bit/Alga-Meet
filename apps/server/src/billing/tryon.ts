/**
 * Try-on in a call (growth-plan §2.4 "Provador"): an item shown on you to the people in your voice channel for
 * TRY_ON_SECONDS, as PublicUser.tryOn in USER_UPDATE ("provando"). Only items on sale, one at a time (a new one
 * replaces it), TRY_ONS_PER_DAY per day; it ends by itself with a USER_UPDATE without it. 16–17: refused at the route.
 * shortcut: in memory (one API instance; a restart ends try-ons early and resets the daily count), move to the DB
 * or Redis when there are several instances.
 */
import { COSMETIC_SLOTS, PRIVATE_COSMETIC_SLOTS, TRY_ON_SECONDS, TRY_ONS_PER_DAY, type TryOn } from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/index.js'
import { users } from '../db/schema.js'
import { HttpError, conflict, notFound } from '../errors.js'
import type { Hub } from '../gateway/hub.js'
import { publicUser } from '../views.js'
import type { Voice } from '../voice.js'
import { isAvailable, productById } from './catalog.js'

const brtDay = (now: number) => new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)

export class TryOns {
  /** Overridable in tests. */
  ttlMs = TRY_ON_SECONDS * 1000
  private readonly live = new Map<string, TryOn & { channelId: string; timer: NodeJS.Timeout }>()
  private readonly daily = new Map<string, { day: string; n: number }>()

  constructor(private readonly db: Db, private readonly hub: Hub, private readonly voice: Voice) {}

  async start(userId: string, productId: string, now = Date.now()): Promise<TryOn> {
    const state = this.voice.stateOf(userId)
    if (!state) throw conflict('Entre numa chamada para provar um item.')
    const p = productById(productId)
    const slot = p?.cosmeticType ? COSMETIC_SLOTS[p.cosmeticType] : undefined
    if (!p || !slot || !isAvailable(p, now) || PRIVATE_COSMETIC_SLOTS.includes(slot)) throw notFound('Produto não encontrado.')
    const day = brtDay(now)
    const count = this.daily.get(userId)
    const n = count?.day === day ? count.n : 0
    if (n >= TRY_ONS_PER_DAY) throw new HttpError('rate_limited', `Você já provou ${TRY_ONS_PER_DAY} itens hoje. Amanhã tem mais.`)
    this.daily.set(userId, { day, n: n + 1 })
    this.clear(userId)
    const tryOn: TryOn = { productId, slot, expiresAt: new Date(now + this.ttlMs).toISOString() }
    const timer = setTimeout(() => { void this.end(userId, tryOn.expiresAt) }, this.ttlMs)
    timer.unref()
    this.live.set(userId, { ...tryOn, channelId: state.channelId, timer })
    await this.announce(userId, state.channelId, tryOn)
    return tryOn
  }

  /** DELETE /billing/try-on, or the timer (only if `expiresAt` is still the live one). */
  async end(userId: string, expiresAt?: string): Promise<void> {
    const cur = this.live.get(userId)
    if (!cur || (expiresAt && cur.expiresAt !== expiresAt)) return
    this.clear(userId)
    await this.announce(userId, cur.channelId)
  }

  stop(): void {
    for (const id of [...this.live.keys()]) this.clear(id)
  }

  private clear(userId: string): void {
    clearTimeout(this.live.get(userId)?.timer)
    this.live.delete(userId)
  }

  private async announce(userId: string, channelId: string, tryOn?: TryOn): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId))
    if (!row) return
    const audience = [...new Set([userId, ...this.voice.inChannel(channelId).map((s) => s.userId)])]
    this.hub.dispatch(audience, 'USER_UPDATE', { ...publicUser(row), ...(tryOn ? { tryOn } : {}) })
  }
}
