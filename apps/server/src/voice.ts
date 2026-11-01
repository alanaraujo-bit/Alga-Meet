/**
 * Voice: LiveKit token minting and the authoritative VoiceState map.
 * Who is in a room comes only from LiveKit (webhooks + startup reconcile); clients only toggle their own flags.
 * Moderation (server mute/deafen, role changes) is enforced at the SFU through participant permissions.
 */
import {
  Permission, STREAM_PRESETS, STREAM_PRESETS_ATTRIBUTE, hasPermission,
  type PlanId, type StreamPreset, type VoiceDisconnectReason, type VoiceState,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, type TrackInfo, type WebhookEvent } from 'livekit-server-sdk'
import {
  NO_MODERATION, PRIVATE_CHANNEL_PERMISSIONS, channelAudience, memberPermissions, spaceMemberIds, voiceModeration,
  type VoiceModeration,
} from './access.js'
import { hasSession } from './auth.js'
import { PLANS } from './billing/catalog.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import { users } from './db/schema.js'
import type { Hub } from './gateway/hub.js'
import { metrics } from './metrics.js'
import { loadChannel } from './views.js'

const ROOM_PREFIX = 'ch_'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const roomName = (channelId: string) => `${ROOM_PREFIX}${channelId}`
export function channelIdOfRoom(room: string): string | null {
  const id = room.startsWith(ROOM_PREFIX) ? room.slice(ROOM_PREFIX.length) : ''
  return UUID_RE.test(id) ? id : null
}

export type SelfFlags = Pick<VoiceState, 'selfMute' | 'selfDeaf' | 'streaming' | 'video'>
const FLAGS = ['selfMute', 'selfDeaf', 'streaming', 'video'] as const
const VOICE_TYPES = ['voice', 'dm', 'group_dm']
/** LiveKit signs webhooks with short-lived JWTs; remembering ids this long covers their validity. */
const WEBHOOK_DEDUPE_MS = 10 * 60_000
/** How long a moderator move lets the user into the target channel even when it is full. */
const MOVE_TICKET_MS = 60_000
/** After a plan change, time a compliant client gets to re-cap a live screen share before the server re-checks it (the desktop takes ~100 ms). */
export const PLAN_RECHECK_MS = 10_000

/**
 * LiveKit grants: SPEAK → microphone + camera, STREAM → screen + its audio; server mute drops the microphone,
 * server deafen drops subscribing. Used for the join token and for live updates (updateParticipant).
 */
export function voiceGrants(permissions: number, mod: VoiceModeration = NO_MODERATION) {
  const sources: TrackSource[] = []
  if (hasPermission(permissions, Permission.SPEAK)) {
    if (!mod.serverMute) sources.push(TrackSource.MICROPHONE)
    sources.push(TrackSource.CAMERA)
  }
  if (hasPermission(permissions, Permission.STREAM)) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO)
  // The data channel would bypass SEND_MESSAGES, blocks and moderation; no feature needs it.
  return { canSubscribe: !mod.serverDeaf, canPublish: sources.length > 0, canPublishSources: sources, canPublishData: false }
}

export class Voice {
  /** userId → state. A user is in at most one voice channel. shortcut: in-memory, single instance; rebuilt from LiveKit on boot. */
  private readonly states = new Map<string, VoiceState>()
  private readonly rooms: RoomServiceClient
  private readonly receiver: WebhookReceiver
  /** Webhook event id → expiry, in insertion (= expiry) order. */
  private readonly seenEvents = new Map<string, number>()
  /** userId → channel a moderator moved them to (bypasses userLimit until `until`). */
  private readonly moves = new Map<string, { channelId: string; until: number }>()
  /** userId → pending post-plan-change screen share re-check (one per user: a newer change restarts it). */
  private readonly rechecks = new Map<string, NodeJS.Timeout>()
  /** Grace before that re-check; tests shorten it. */
  planRecheckMs = PLAN_RECHECK_MS
  /**
   * A user's voice state in a channel ended (left, kicked, banned, moved, lost access, channel deleted). src/e2ee.ts
   * hooks it to remove their MLS leaf at once, without waiting for LiveKit's webhook.
   */
  onLeave: (userId: string, channelId: string) => void = () => {}

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly log: FastifyBaseLogger,
  ) {
    const { url, apiKey, apiSecret } = config.livekit
    this.rooms = new RoomServiceClient(url, apiKey, apiSecret, { requestTimeout: 5 })
    this.receiver = new WebhookReceiver(apiKey, apiSecret)
  }

  all(): VoiceState[] {
    return [...this.states.values()]
  }

  stateOf(userId: string): VoiceState | undefined {
    return this.states.get(userId)
  }

  inChannel(channelId: string): VoiceState[] {
    return this.all().filter((s) => s.channelId === channelId)
  }

  /**
   * Access token for `ch_<channelId>` with `voiceGrants` and the plan's screen-share presets as a participant
   * attribute (no canUpdateOwnMetadata grant, so the client cannot change it).
   */
  async mintToken(
    user: { id: string; displayName: string }, channelId: string, permissions: number, mod = NO_MODERATION,
    streamPresets: StreamPreset[] = PLANS.free.streamPresets,
  ): Promise<string> {
    const at = new AccessToken(this.config.livekit.apiKey, this.config.livekit.apiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: 60 * 60,
      attributes: { [STREAM_PRESETS_ATTRIBUTE]: streamPresets.join(',') },
    })
    at.addGrant({ roomJoin: true, room: roomName(channelId), ...voiceGrants(permissions, mod) })
    return at.toJwt()
  }

  /** A pending moderator move into `channelId` (lets /voice/join and the join through a full channel). */
  hasMoveTicket(userId: string, channelId: string): boolean {
    const t = this.moves.get(userId)
    return !!t && t.channelId === channelId && t.until > Date.now()
  }

  /** Verifies the LiveKit signature (JWT whose sha256 claim covers the raw body). Throws on failure. */
  receive(rawBody: string, authHeader: string | undefined): Promise<WebhookEvent> {
    return this.receiver.receive(rawBody, authHeader)
  }

  async handleEvent(ev: WebhookEvent): Promise<void> {
    if (this.isReplay(ev.id)) return
    const channelId = ev.room ? channelIdOfRoom(ev.room.name) : null
    if (!channelId) return
    const identity = ev.participant?.identity ?? ''
    switch (ev.event) {
      case 'participant_joined':
        await this.participantJoined(channelId, identity, joinedAtOf(ev.participant), true, ev.participant?.attributes?.[STREAM_PRESETS_ATTRIBUTE])
        break
      case 'participant_left':
      case 'participant_connection_aborted':
        await this.participantLeft(channelId, identity)
        break
      case 'room_finished':
        for (const s of this.inChannel(channelId)) await this.remove(s)
        break
      case 'track_published':
        await this.checkScreenShare(channelId, identity, ev.track)
        break
      default:
        break
    }
  }

  /** `presetsAttr`: the presets attribute LiveKit reports for the participant (from their token). */
  async participantJoined(channelId: string, userId: string, joinedAt: string, ring: boolean, presetsAttr?: string): Promise<void> {
    if (!UUID_RE.test(userId)) return
    const found = await loadChannel(this.db, channelId)
    if (!found || !VOICE_TYPES.includes(found.row.type)) {
      // Tokens outlive deleted channels; LiveKit would recreate the room, so the participant must go.
      this.log.warn({ channelId, userId }, 'voice: participant joined a room without a matching channel, removing')
      metrics.voiceJoins.inc({ result: 'no_channel' })
      await this.kick(channelId, userId)
      return
    }
    const { row, recipientIds } = found
    const permissions = row.spaceId ? (await memberPermissions(this.db, row.spaceId, userId)).get(userId) ?? 0 : PRIVATE_CHANNEL_PERMISSIONS
    const mod = row.spaceId ? await voiceModeration(this.db, row.spaceId, userId) : NO_MODERATION
    // Tokens live for an hour, so re-check access: a kicked or logged-out user must not linger in the room.
    const allowed = (row.spaceId ? hasPermission(permissions, Permission.CONNECT) : recipientIds.includes(userId))
      && await hasSession(this.db, userId)
    if (!allowed) {
      this.log.warn({ channelId, userId }, 'voice: participant without access, removing from room')
      metrics.voiceJoins.inc({ result: 'access_lost' })
      await this.kickWith(channelId, userId, 'access_lost')
      return
    }
    // No await from here until states.set: concurrent joins cannot both take the last free slot.
    const prev = this.states.get(userId)
    if (prev?.channelId === channelId) return // duplicate delivery / reconcile of a known state
    const others = this.inChannel(channelId).length
    const limit = row.userLimit ?? 0
    const moved = this.hasMoveTicket(userId, channelId)
    if (limit > 0 && others >= limit && !moved && !hasPermission(permissions, Permission.MOVE_MEMBERS)) {
      this.log.info({ channelId, userId }, 'voice: channel full, removing participant')
      metrics.voiceJoins.inc({ result: 'channel_full' })
      await this.kickWith(channelId, userId, 'channel_full')
      return
    }
    if (moved) this.moves.delete(userId)
    const wasEmpty = others === 0
    const state: VoiceState = {
      userId,
      channelId,
      spaceId: row.spaceId,
      selfMute: prev?.selfMute ?? false,
      selfDeaf: prev?.selfDeaf ?? false,
      serverMute: mod.serverMute,
      serverDeaf: mod.serverDeaf,
      streaming: false,
      video: false,
      joinedAt,
    }
    this.states.set(userId, state)
    metrics.voiceJoins.inc({ result: 'joined' })
    if (prev) {
      this.onLeave(userId, prev.channelId)
      this.hub.dispatch([...await this.audience(prev), userId], 'VOICE_STATE_REMOVE', { userId, channelId: prev.channelId })
      await this.kick(prev.channelId, userId)
    }
    this.hub.dispatch(await this.audience(state), 'VOICE_STATE_UPDATE', state)
    if (ring && wasEmpty && !row.spaceId) {
      this.hub.dispatch(recipientIds.filter((id) => id !== userId), 'CALL_RING', { channelId, fromUserId: userId })
    }
    // A token minted before the mute/deafen still carries the old grants.
    if (mod.serverMute || mod.serverDeaf) await this.enforce(state, permissions)
    // Same for a plan change between /voice/join and this join: it found no VoiceState to update.
    if (presetsAttr !== undefined) {
      const presets = PLANS[await this.planOf(userId)].streamPresets
      if (presets.join(',') !== presetsAttr) await this.setStreamPresets(userId, presets)
    }
  }

  async participantLeft(channelId: string, userId: string): Promise<void> {
    const prev = this.states.get(userId)
    if (prev?.channelId === channelId) await this.remove(prev)
  }

  /** Gateway op `voice_state`: merges the user's own flags (streaming needs STREAM, video SPEAK). Ignored when not in voice. */
  async updateSelf(userId: string, flags: SelfFlags): Promise<void> {
    const current = this.states.get(userId)
    if (!current) return
    const permissions = await this.permissionsOf(current)
    const prev = this.states.get(userId)
    if (!prev) return
    const state = {
      ...prev,
      ...flags,
      streaming: flags.streaming && hasPermission(permissions, Permission.STREAM),
      video: flags.video && hasPermission(permissions, Permission.SPEAK),
    }
    if (FLAGS.every((k) => state[k] === prev[k])) return
    this.states.set(userId, state)
    this.hub.dispatch(await this.audience(state), 'VOICE_STATE_UPDATE', state)
  }

  /**
   * Disconnects a user from voice in any of `channelIds` (leave/kick), or from any channel when omitted.
   * With a `reason` the user also gets VOICE_DISCONNECT. Returns whether they were connected there.
   */
  async disconnect(userId: string, channelIds?: string[], reason?: VoiceDisconnectReason): Promise<boolean> {
    const s = this.states.get(userId)
    if (!s || (channelIds && !channelIds.includes(s.channelId))) return false
    await this.remove(s)
    if (reason) await this.kickWith(s.channelId, userId, reason)
    else await this.kick(s.channelId, userId)
    return true
  }

  /** Server mute/deafen changed for a member of `spaceId`: update their live state (if in voice there) and the SFU. */
  async moderate(userId: string, spaceId: string, mod: VoiceModeration): Promise<void> {
    const prev = this.states.get(userId)
    if (prev?.spaceId !== spaceId) return
    if (prev.serverMute === mod.serverMute && prev.serverDeaf === mod.serverDeaf) return
    const state = { ...prev, ...mod }
    this.states.set(userId, state)
    this.hub.dispatch(await this.audience(state), 'VOICE_STATE_UPDATE', state)
    await this.enforce(state)
  }

  /**
   * Moderator move to another voice channel of the same space: VOICE_MOVE to the user, then they are dropped from
   * the current room and may join the target (even if full) for MOVE_TICKET_MS. False if not in voice in that space.
   */
  async move(userId: string, spaceId: string, toChannelId: string): Promise<boolean> {
    const s = this.states.get(userId)
    if (s?.spaceId !== spaceId) return false
    if (s.channelId === toChannelId) return true
    this.moves.set(userId, { channelId: toChannelId, until: Date.now() + MOVE_TICKET_MS })
    this.hub.dispatch([userId], 'VOICE_MOVE', { channelId: toChannelId })
    await this.remove(s)
    await this.kick(s.channelId, userId)
    return true
  }

  /** Role/permission changes: re-apply SFU grants for members of `spaceId` in voice; drop those who lost CONNECT. */
  async refreshSpace(spaceId: string, userIds?: string[]): Promise<void> {
    const affected = this.all().filter((s) => s.spaceId === spaceId && (!userIds || userIds.includes(s.userId)))
    if (!affected.length) return
    const perms = await memberPermissions(this.db, spaceId)
    for (const s of affected) {
      const p = perms.get(s.userId) ?? 0
      if (!hasPermission(p, Permission.CONNECT)) await this.disconnect(s.userId, [s.channelId], 'access_lost')
      else await this.enforce(s, p)
    }
  }

  /** Channel/space being deleted: forget its states and close the LiveKit rooms. `audience` is computed before deletion. */
  async dropChannels(channelIds: string[], audience: string[]): Promise<void> {
    for (const s of this.all()) {
      if (!channelIds.includes(s.channelId)) continue
      this.states.delete(s.userId)
      this.onLeave(s.userId, s.channelId)
      this.hub.dispatch([...audience, s.userId], 'VOICE_STATE_REMOVE', { userId: s.userId, channelId: s.channelId })
    }
    for (const id of channelIds) {
      await this.rooms.deleteRoom(roomName(id)).catch((err: unknown) => {
        this.log.warn({ err, channelId: id }, 'voice: could not delete LiveKit room')
      })
    }
  }

  /** Best-effort startup sync from the SFU; logs and continues if it is unreachable. */
  async reconcile(): Promise<void> {
    try {
      const rooms = await this.rooms.listRooms()
      let n = 0
      for (const r of rooms) {
        const channelId = channelIdOfRoom(r.name)
        if (!channelId) continue
        for (const p of await this.rooms.listParticipants(r.name)) {
          await this.participantJoined(channelId, p.identity, joinedAtOf(p), false, p.attributes[STREAM_PRESETS_ATTRIBUTE])
          n++
        }
      }
      this.log.info({ rooms: rooms.length, participants: n }, 'voice: reconciled with LiveKit')
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'voice: LiveKit unreachable, skipping reconcile')
    }
  }

  private async remove(s: VoiceState): Promise<void> {
    if (this.states.get(s.userId)?.channelId !== s.channelId) return
    this.states.delete(s.userId)
    this.onLeave(s.userId, s.channelId)
    this.hub.dispatch([...await this.audience(s), s.userId], 'VOICE_STATE_REMOVE', { userId: s.userId, channelId: s.channelId })
  }

  private async kick(channelId: string, userId: string): Promise<void> {
    await this.rooms.removeParticipant(roomName(channelId), userId).catch((err: unknown) => {
      this.log.warn({ err: (err as Error).message, channelId, userId }, 'voice: could not remove participant from LiveKit')
    })
  }

  /** Removes from the SFU and tells the user why (they never got a VoiceState for this room). */
  private async kickWith(channelId: string, userId: string, reason: VoiceDisconnectReason): Promise<void> {
    await this.kick(channelId, userId)
    this.hub.dispatch([userId], 'VOICE_DISCONNECT', { channelId, reason })
  }

  /** Pushes `voiceGrants` to the participant and mutes an already published microphone when server-muted. */
  private async enforce(s: VoiceState, permissions?: number): Promise<void> {
    const room = roomName(s.channelId)
    try {
      await this.rooms.updateParticipant(room, s.userId, { permission: voiceGrants(permissions ?? await this.permissionsOf(s), s) })
      if (!s.serverMute) return
      const p = await this.rooms.getParticipant(room, s.userId)
      for (const t of p.tracks) {
        if (t.source === TrackSource.MICROPHONE && !t.muted) await this.rooms.mutePublishedTrack(room, s.userId, t.sid, true)
      }
    } catch (err) {
      this.log.warn({ err: (err as Error).message, channelId: s.channelId, userId: s.userId }, 'voice: could not apply grants on LiveKit')
    }
  }

  /**
   * Plan changed: refresh the presets attribute of a user in voice at once (the client also gets ENTITLEMENTS_UPDATE),
   * then re-check their live screen shares after `planRecheckMs`. An upgrade has nothing above it, so that is a no-op.
   */
  async setStreamPresets(userId: string, presets: StreamPreset[]): Promise<void> {
    const s = this.states.get(userId)
    if (!s) return
    clearTimeout(this.rechecks.get(userId))
    this.rechecks.set(userId, setTimeout(() => {
      this.rechecks.delete(userId)
      void this.recheckScreenShares(userId)
    }, this.planRecheckMs).unref())
    await this.rooms.updateParticipant(roomName(s.channelId), userId, { attributes: { [STREAM_PRESETS_ATTRIBUTE]: presets.join(',') } })
      .catch((err: unknown) => this.log.warn({ err: (err as Error).message, userId }, 'voice: could not update stream presets on LiveKit'))
  }

  /** Drops pending plan re-checks (shutdown). */
  stop(): void {
    for (const t of this.rechecks.values()) clearTimeout(t)
    this.rechecks.clear()
  }

  /**
   * After the grace of a plan change: each unmuted screen share of the user is checked like at publish time. LiveKit
   * reports the layers declared at publish; an in-place re-cap (same publication) does not change them (README).
   */
  private async recheckScreenShares(userId: string): Promise<void> {
    const s = this.states.get(userId)
    if (!s) return
    try {
      const p = await this.rooms.getParticipant(roomName(s.channelId), userId)
      for (const t of p.tracks) if (!t.muted) await this.checkScreenShare(s.channelId, userId, t)
    } catch (err) {
      this.log.warn({ err: (err as Error).message, channelId: s.channelId, userId }, 'voice: could not re-check screen shares after a plan change')
    }
  }

  private async planOf(userId: string): Promise<PlanId> {
    const [u] = await this.db.select({ plan: users.plan }).from(users).where(eq(users.id, userId))
    return (u?.plan ?? 'free') as PlanId
  }

  /**
   * Server-side check of D11: a screen share above the user's plan is muted at the SFU. Uses the dimensions/bitrates
   * of the simulcast layers as LiveKit reports them at publish time (declared by the client SDK; a modified client
   * could under-declare, see README). Short side vs preset height, so ultrawide/portrait screens are fine.
   */
  private async checkScreenShare(channelId: string, userId: string, track: TrackInfo | undefined): Promise<void> {
    if (track?.source !== TrackSource.SCREEN_SHARE || !UUID_RE.test(userId)) return
    const plan = await this.planOf(userId)
    const presets = PLANS[plan].streamPresets.map((p) => STREAM_PRESETS[p])
    const maxSide = Math.max(...presets.map((p) => p.height))
    const maxBps = Math.max(...presets.map((p) => p.maxBitrateKbps)) * 1000 * 1.1 // 10% encoder slack
    const layers = [...track.layers, ...track.codecs.flatMap((c) => c.layers)]
    const dims = layers.length ? layers : [track]
    const side = Math.max(...dims.map((l) => Math.min(l.width, l.height)))
    const bps = Math.max(0, ...layers.map((l) => l.bitrate))
    if (side <= maxSide && bps <= maxBps) return
    this.log.warn({ channelId, userId, side, bps, plan }, 'voice: screen share above the plan, muting it')
    await this.rooms.mutePublishedTrack(roomName(channelId), userId, track.sid, true)
      .catch((err: unknown) => this.log.warn({ err: (err as Error).message, userId }, 'voice: could not mute screen share'))
  }

  private async permissionsOf(s: VoiceState): Promise<number> {
    return s.spaceId ? (await memberPermissions(this.db, s.spaceId, s.userId)).get(s.userId) ?? 0 : PRIVATE_CHANNEL_PERMISSIONS
  }

  private isReplay(id: string): boolean {
    const now = Date.now()
    for (const [k, exp] of this.seenEvents) {
      if (exp > now) break
      this.seenEvents.delete(k)
    }
    if (!id) return false
    if (this.seenEvents.has(id)) return true
    this.seenEvents.set(id, now + WEBHOOK_DEDUPE_MS)
    return false
  }

  private audience(s: VoiceState): Promise<string[]> {
    return s.spaceId ? spaceMemberIds(this.db, s.spaceId) : channelAudience(this.db, { id: s.channelId, spaceId: null })
  }
}

function joinedAtOf(p: { joinedAt: bigint; joinedAtMs: bigint } | undefined): string {
  const ms = p ? (p.joinedAtMs ? Number(p.joinedAtMs) : Number(p.joinedAt) * 1000) : 0
  return new Date(ms || Date.now()).toISOString()
}

