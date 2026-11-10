/**
 * Music in a call (packages/shared/src/music.ts): the queue and the shared clock of the song, per voice channel, in
 * memory. Everyone in the call can add, pause, skip and remove; every app plays the song in YouTube's own player, so no
 * audio passes through here. The title comes from YouTube's oEmbed (which also says when a video cannot be embedded).
 * The music of a call ends when the call empties.
 */
import {
  MUSIC_ADD_RATE, MUSIC_LEAD_MS, MUSIC_QUEUE_MAX, musicPosition, uuidv7, youtubeId,
  type DispatchOf, type DispatchType, type MusicClientFrame, type MusicErrorReason, type MusicEventKind, type MusicPlayback, type MusicState, type MusicTrack,
} from '@alga/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { Conn, Hub } from './gateway/hub.js'
import type { Voice } from './voice.js'

/** After a song's known end, this long without an "ended" from any app and the server moves on by itself. */
const END_GRACE_MS = 2_500
const META_TIMEOUT_MS = 5_000
const TITLE_MAX = 200

export type MusicMeta = { title: string; author: string | null } | 'not_embeddable' | 'unavailable'

/** YouTube oEmbed: 200 with the title, 401 when the owner disabled embedding, 400/404 when it does not exist. */
export async function youtubeMeta(videoId: string): Promise<MusicMeta> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(META_TIMEOUT_MS) })
  if (res.status === 401 || res.status === 403) return 'not_embeddable'
  if (!res.ok) return 'unavailable'
  const d = (await res.json()) as { title?: unknown; author_name?: unknown }
  const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, TITLE_MAX) : null
  if (!title) return 'unavailable'
  return { title, author: typeof d.author_name === 'string' ? d.author_name.trim().slice(0, TITLE_MAX) || null : null }
}

interface Call {
  channelId: string
  now: MusicTrack | null
  queue: MusicTrack[]
  playback: MusicPlayback
  last: MusicState['last']
  /** Moves on when a known song ends and no app said so. */
  endTimer?: NodeJS.Timeout
}

export class Music {
  readonly calls = new Map<string, Call>()
  private readonly rate = new Map<string, { tokens: number; at: number }>()
  /** Replaced in tests (no network). */
  meta: (videoId: string) => Promise<MusicMeta> = youtubeMeta

  constructor(private readonly hub: Hub, private readonly voice: Voice, private readonly log: FastifyBaseLogger) {
    // voice.onLeave is a single slot others chain onto (e2ee, cinema): chain too.
    const prev = voice.onLeave
    voice.onLeave = (userId, channelId) => {
      prev(userId, channelId)
      this.left(channelId)
    }
  }

  stop(): void {
    for (const c of this.calls.values()) clearTimeout(c.endTimer)
    this.calls.clear()
  }

  async handle(conn: Conn, f: MusicClientFrame): Promise<void> {
    if (this.voice.stateOf(conn.userId)?.channelId !== f.channelId) return this.error(conn, f.op, 'not_in_call')
    switch (f.op) {
      case 'music_hello':
        return this.reply(conn, 'MUSIC_STATE', this.view(this.calls.get(f.channelId) ?? this.empty(f.channelId)))
      case 'music_add':
        return this.add(conn, f.channelId, f.url)
      case 'music_control':
        return this.control(conn.userId, f.channelId, f.action, f.position)
      case 'music_remove':
        return this.remove(conn, f.channelId, f.trackId)
      case 'music_report':
        return this.report(f.channelId, f.trackId, f.kind, f.durationS)
    }
  }

  private async add(conn: Conn, channelId: string, url: string): Promise<void> {
    if (!this.take(conn.userId)) return this.error(conn, 'music_add', 'slow_down')
    const videoId = youtubeId(url)
    if (!videoId) return this.error(conn, 'music_add', 'invalid_link')
    const queued = this.calls.get(channelId)?.queue.length ?? 0
    if (queued >= MUSIC_QUEUE_MAX) return this.error(conn, 'music_add', 'queue_full')
    let meta: MusicMeta
    try {
      meta = await this.meta(videoId)
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'music: oEmbed failed')
      meta = 'unavailable'
    }
    if (typeof meta === 'string') return this.error(conn, 'music_add', meta)
    // The call may have emptied, or the person left it, while YouTube answered.
    if (this.voice.stateOf(conn.userId)?.channelId !== channelId) return this.error(conn, 'music_add', 'not_in_call')
    const c = this.calls.get(channelId) ?? this.empty(channelId)
    this.calls.set(channelId, c)
    if (c.queue.length >= MUSIC_QUEUE_MAX) return this.error(conn, 'music_add', 'queue_full')
    const track: MusicTrack = { id: uuidv7(), videoId, title: meta.title, author: meta.author, durationS: null, addedBy: conn.userId }
    if (c.now) c.queue.push(track)
    else this.start(c, track)
    c.last = { kind: 'add', by: conn.userId, title: track.title }
    this.broadcast(c)
  }

  private control(by: string, channelId: string, action: 'play' | 'pause' | 'skip' | 'seek' | 'stop', position?: number): void {
    const c = this.calls.get(channelId)
    if (!c?.now) return
    const now = Date.now()
    const here = musicPosition(c.playback, now, c.now.durationS)
    const seq = c.playback.seq + 1
    let kind: MusicEventKind = action
    const title = c.now.title
    switch (action) {
      case 'play':
        if (c.playback.playing) return
        c.playback = { playing: true, position: here, at: now + MUSIC_LEAD_MS / 2, seq }
        break
      case 'pause':
        if (!c.playback.playing) return
        c.playback = { playing: false, position: here, at: now, seq }
        break
      case 'seek': {
        const to = Math.min(position ?? 0, c.now.durationS ?? Number.POSITIVE_INFINITY)
        c.playback = { playing: c.playback.playing, position: to, at: c.playback.playing ? now + MUSIC_LEAD_MS / 2 : now, seq }
        break
      }
      case 'skip':
        this.advance(c)
        break
      case 'stop':
        c.queue = []
        c.now = null
        c.playback = { playing: false, position: 0, at: now, seq }
        kind = 'stop'
        break
    }
    c.last = { kind, by, title }
    this.arm(c)
    this.broadcast(c)
  }

  private remove(conn: Conn, channelId: string, trackId: string): void {
    const c = this.calls.get(channelId)
    const i = c?.queue.findIndex((t) => t.id === trackId) ?? -1
    if (!c || i < 0) return this.error(conn, 'music_remove', 'not_found')
    const [t] = c.queue.splice(i, 1)
    c.last = { kind: 'remove', by: conn.userId, title: t!.title }
    this.broadcast(c)
  }

  /** What an app's player saw. Only about the song playing now: a late report about an old one does nothing. */
  private report(channelId: string, trackId: string, kind: 'ended' | 'unplayable' | 'duration', durationS?: number): void {
    const c = this.calls.get(channelId)
    if (!c?.now || c.now.id !== trackId) return
    if (kind === 'duration') {
      if (c.now.durationS !== null || !durationS) return
      c.now.durationS = durationS
      this.arm(c)
      return this.broadcast(c)
    }
    // "ended" before the song could have ended (an app that jumped ahead, or lies): not believed.
    if (kind === 'ended' && c.now.durationS !== null && musicPosition(c.playback, Date.now(), null) < c.now.durationS - 5) return
    const title = c.now.title
    this.advance(c)
    c.last = { kind, by: null, title }
    this.arm(c)
    this.broadcast(c)
  }

  private start(c: Call, track: MusicTrack): void {
    c.now = track
    c.playback = { playing: true, position: 0, at: Date.now() + MUSIC_LEAD_MS, seq: c.playback.seq + 1 }
    this.arm(c)
  }

  private advance(c: Call): void {
    const next = c.queue.shift()
    if (next) return this.start(c, next)
    c.now = null
    c.playback = { playing: false, position: 0, at: Date.now(), seq: c.playback.seq + 1 }
  }

  /** The server's own end of the song: the known length plus a grace, while playing. */
  private arm(c: Call): void {
    clearTimeout(c.endTimer)
    c.endTimer = undefined
    const d = c.now?.durationS
    if (!c.now || d == null || !c.playback.playing) return
    const endsAt = c.playback.at + (d - c.playback.position) * 1000
    const trackId = c.now.id
    c.endTimer = setTimeout(() => {
      if (this.calls.get(c.channelId) !== c || c.now?.id !== trackId) return
      const title = c.now.title
      this.advance(c)
      c.last = { kind: 'ended', by: null, title }
      this.arm(c)
      this.broadcast(c)
    }, Math.max(0, endsAt - Date.now()) + END_GRACE_MS)
  }

  /** voice.onLeave: the music of a call ends with the call. */
  private left(channelId: string): void {
    const c = this.calls.get(channelId)
    if (!c || this.voice.inChannel(channelId).length > 0) return
    clearTimeout(c.endTimer)
    this.calls.delete(channelId)
  }

  private take(userId: string): boolean {
    const now = Date.now()
    const b = this.rate.get(userId)
    const tokens = Math.min(MUSIC_ADD_RATE.burst, (b?.tokens ?? MUSIC_ADD_RATE.burst) + (b ? ((now - b.at) / 1000) * MUSIC_ADD_RATE.perSecond : 0))
    if (tokens < 1) {
      this.rate.set(userId, { tokens, at: now })
      return false
    }
    this.rate.set(userId, { tokens: tokens - 1, at: now })
    // shortcut: buckets are never pruned (a few bytes per person who ever added a song); prune on a timer if it grows.
    return true
  }

  private empty(channelId: string): Call {
    return { channelId, now: null, queue: [], playback: { playing: false, position: 0, at: Date.now(), seq: 0 }, last: null }
  }

  private view(c: Call): MusicState {
    return { channelId: c.channelId, now: c.now, queue: c.queue, playback: c.playback, serverNow: Date.now(), last: c.last }
  }

  private broadcast(c: Call): void {
    this.hub.dispatch(this.voice.inChannel(c.channelId).map((v) => v.userId), 'MUSIC_STATE', this.view(c))
  }

  private reply<T extends DispatchType>(conn: Conn, t: T, d: DispatchOf<T>): void {
    conn.send(JSON.stringify({ op: 'dispatch', t, d }))
  }

  private error(conn: Conn, op: string, reason: MusicErrorReason): void {
    this.reply(conn, 'MUSIC_ERROR', { op, reason })
  }
}
