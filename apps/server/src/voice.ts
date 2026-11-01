/**
 * Voice: LiveKit token minting and the authoritative VoiceState map.
 * Who is in a room comes only from LiveKit (webhooks + startup reconcile); clients only toggle their own flags.
 */
import { Permission, hasPermission, type VoiceState } from '@alga/shared'
import type { FastifyBaseLogger } from 'fastify'
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk'
import { channelAudience, memberPermissions, spaceMemberIds } from './access.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import type { Hub } from './gateway/hub.js'
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

export class Voice {
  /** userId → state. A user is in at most one voice channel. shortcut: in-memory, single instance; rebuilt from LiveKit on boot. */
  private readonly states = new Map<string, VoiceState>()
  private readonly rooms: RoomServiceClient
  private readonly receiver: WebhookReceiver

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

  inChannel(channelId: string): VoiceState[] {
    return this.all().filter((s) => s.channelId === channelId)
  }

  /** Access token for `ch_<channelId>`; publish sources follow SPEAK (mic, camera) and STREAM (screen + its audio). */
  async mintToken(user: { id: string; displayName: string }, channelId: string, permissions: number): Promise<string> {
    const sources: TrackSource[] = []
    if (hasPermission(permissions, Permission.SPEAK)) sources.push(TrackSource.MICROPHONE, TrackSource.CAMERA)
    if (hasPermission(permissions, Permission.STREAM)) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO)
    const at = new AccessToken(this.config.livekit.apiKey, this.config.livekit.apiSecret, {
      identity: user.id,
      name: user.displayName,
      ttl: 60 * 60,
    })
    at.addGrant({
      roomJoin: true,
      room: roomName(channelId),
      canSubscribe: true,
      canPublish: sources.length > 0,
      canPublishSources: sources,
      canPublishData: true,
    })
    return at.toJwt()
  }

  /** Verifies the LiveKit signature (JWT whose sha256 claim covers the raw body). Throws on failure. */
  receive(rawBody: string, authHeader: string | undefined): Promise<WebhookEvent> {
    return this.receiver.receive(rawBody, authHeader)
  }

  async handleEvent(ev: WebhookEvent): Promise<void> {
    const channelId = ev.room ? channelIdOfRoom(ev.room.name) : null
    if (!channelId) return
    const identity = ev.participant?.identity ?? ''
    switch (ev.event) {
      case 'participant_joined':
        await this.participantJoined(channelId, identity, joinedAtOf(ev.participant), true)
        break
      case 'participant_left':
      case 'participant_connection_aborted':
        await this.participantLeft(channelId, identity)
        break
      case 'room_finished':
        for (const s of this.inChannel(channelId)) await this.remove(s)
        break
      default:
        break
    }
  }

  async participantJoined(channelId: string, userId: string, joinedAt: string, ring: boolean): Promise<void> {
    if (!UUID_RE.test(userId)) return
    const found = await loadChannel(this.db, channelId)
    if (!found || !['voice', 'dm', 'group_dm'].includes(found.row.type)) {
      this.log.warn({ channelId, userId }, 'voice: participant joined a room without a matching channel')
      return
    }
    const { row, recipientIds } = found
    // Tokens live for an hour, so re-check access: a kicked member must not linger in the room.
    const allowed = row.spaceId
      ? hasPermission((await memberPermissions(this.db, row.spaceId, userId)).get(userId) ?? 0, Permission.CONNECT)
      : recipientIds.includes(userId)
    if (!allowed) {
      this.log.warn({ channelId, userId }, 'voice: participant without access, removing from room')
      await this.kick(channelId, userId)
      return
    }
    const prev = this.states.get(userId)
    if (prev?.channelId === channelId) return // duplicate delivery / reconcile of a known state
    if (prev) {
      await this.remove(prev)
      await this.kick(prev.channelId, userId)
    }
    const wasEmpty = this.inChannel(channelId).length === 0
    const state: VoiceState = {
      userId,
      channelId,
      spaceId: row.spaceId,
      selfMute: prev?.selfMute ?? false,
      selfDeaf: prev?.selfDeaf ?? false,
      serverMute: false,
      serverDeaf: false,
      streaming: false,
      video: false,
      joinedAt,
    }
    this.states.set(userId, state)
    this.hub.dispatch(await this.audience(state), 'VOICE_STATE_UPDATE', state)
    if (ring && wasEmpty && !row.spaceId) {
      this.hub.dispatch(recipientIds.filter((id) => id !== userId), 'CALL_RING', { channelId, fromUserId: userId })
    }
  }

  async participantLeft(channelId: string, userId: string): Promise<void> {
    const prev = this.states.get(userId)
    if (prev?.channelId === channelId) await this.remove(prev)
  }

  /** Gateway op `voice_state`: merges the user's own flags. Ignored when not in voice. */
  async updateSelf(userId: string, flags: SelfFlags): Promise<void> {
    const prev = this.states.get(userId)
    if (!prev) return
    const state = { ...prev, ...flags }
    if (FLAGS.every((k) => state[k] === prev[k])) return
    this.states.set(userId, state)
    this.hub.dispatch(await this.audience(state), 'VOICE_STATE_UPDATE', state)
  }

  /** Disconnects a user from voice in any of `channelIds` (leave/kick). */
  async disconnect(userId: string, channelIds: string[]): Promise<void> {
    const s = this.states.get(userId)
    if (!s || !channelIds.includes(s.channelId)) return
    await this.remove(s)
    await this.kick(s.channelId, userId)
  }

  /** Channel/space being deleted: forget its states and close the LiveKit rooms. `audience` is computed before deletion. */
  async dropChannels(channelIds: string[], audience: string[]): Promise<void> {
    for (const s of this.all()) {
      if (!channelIds.includes(s.channelId)) continue
      this.states.delete(s.userId)
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
          await this.participantJoined(channelId, p.identity, joinedAtOf(p), false)
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
    this.hub.dispatch([...await this.audience(s), s.userId], 'VOICE_STATE_REMOVE', { userId: s.userId, channelId: s.channelId })
  }

  private async kick(channelId: string, userId: string): Promise<void> {
    await this.rooms.removeParticipant(roomName(channelId), userId).catch((err: unknown) => {
      this.log.warn({ err: (err as Error).message, channelId, userId }, 'voice: could not remove participant from LiveKit')
    })
  }

  private audience(s: VoiceState): Promise<string[]> {
    return s.spaceId ? spaceMemberIds(this.db, s.spaceId) : channelAudience(this.db, { id: s.channelId, spaceId: null })
  }
}

function joinedAtOf(p: { joinedAt: bigint; joinedAtMs: bigint } | undefined): string {
  const ms = p ? (p.joinedAtMs ? Number(p.joinedAtMs) : Number(p.joinedAt) * 1000) : 0
  return new Date(ms || Date.now()).toISOString()
}

