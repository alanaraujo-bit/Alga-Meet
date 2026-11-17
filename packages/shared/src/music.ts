/**
 * Music in a call (the "music bot"): someone pastes a YouTube link, everyone in the call hears it. The server keeps the
 * queue and the shared clock of the song; every app plays it in YouTube's own embedded player, in step. No audio goes
 * through our servers: each person's app plays it from YouTube (YouTube's terms forbid pulling the audio out of their
 * player), so the player stays visible while it plays and YouTube's ads show to each person.
 */
import { z } from 'zod'

/** A whole playlist fits. */
export const MUSIC_QUEUE_MAX = 200
/** A few links at once is fine; a flood is not (then one every 2 s). */
export const MUSIC_ADD_RATE = { perSecond: 0.5, burst: 5 } as const
/** The room starts a song this long after it is chosen, so every app has time to load it. */
export const MUSIC_LEAD_MS = 800

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

/** The video id of a YouTube link (watch, youtu.be, shorts, embed, live, music), or null for anything else. */
export function youtubeId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (YT_HOSTS.has(host)) {
    const [, first, second] = u.pathname.split('/')
    if (first === 'watch') id = u.searchParams.get('v')
    else if (first === 'shorts' || first === 'embed' || first === 'live' || first === 'v') id = second ?? null
  }
  return id && YT_ID.test(id) ? id : null
}

const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/
/**
 * The playlist id of a YouTube link (`/playlist?list=`, or `watch?v=…&list=`), or null. Mixes (`RD…`) are YouTube's own
 * endless radios: its embed refuses them (error 150), so they are not playlists here.
 */
export function youtubeListId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !(YT_HOSTS.has(u.hostname.toLowerCase()) || u.hostname.toLowerCase() === 'youtu.be')) return null
  const list = u.searchParams.get('list')
  return list && YT_LIST.test(list) && !list.startsWith('RD') ? list : null
}

/** Video ids, deduplicated in order, at most `max`: what a saved playlist or a playlist link turns into. */
export const uniqueVideoIds = (ids: readonly string[], max = PLAYLIST_MAX_ITEMS): string[] =>
  [...new Set(ids.filter((id) => YT_ID.test(id)))].slice(0, max)

// ── Saved playlists (per person; REST, routes in apps/server/src/routes/playlists.ts) ─────────────────────────────────
//   GET    /music/playlists         → SavedPlaylist[] (mine, last changed first)
//   POST   /music/playlists         PlaylistCreateBody → 201 SavedPlaylist
//   PATCH  /music/playlists/:id     PlaylistPatchBody  → SavedPlaylist
//   DELETE /music/playlists/:id     → 204
// The server looks every song up on YouTube itself (title, can it play outside YouTube): songs that cannot are left out.

export const PLAYLISTS_MAX = 50
export const PLAYLIST_MAX_ITEMS = 200
export const PLAYLIST_NAME_MAX = 80

export interface PlaylistItem { videoId: string; title: string; author: string | null }
export interface SavedPlaylist {
  id: string
  name: string
  items: PlaylistItem[]
  createdAt: string
  updatedAt: string
}

const videoIds = z.array(z.string().regex(YT_ID)).min(1).max(PLAYLIST_MAX_ITEMS)
const playlistName = z.string().trim().min(1).max(PLAYLIST_NAME_MAX)
export const PlaylistCreateBody = z.object({
  /** Omitted with `listId`: the YouTube playlist's own name. */
  name: playlistName.optional(),
  videoIds,
  /** The YouTube playlist it came from (its name is looked up when `name` is omitted). */
  listId: z.string().regex(YT_LIST).optional(),
})
export type PlaylistCreateBody = z.infer<typeof PlaylistCreateBody>
export const PlaylistPatchBody = z.object({ name: playlistName.optional(), videoIds: videoIds.optional() })
  .refine((b) => b.name !== undefined || b.videoIds !== undefined, 'Nada para mudar.')
export type PlaylistPatchBody = z.infer<typeof PlaylistPatchBody>

export interface MusicTrack {
  /** One per place in the queue (the same video twice is two tracks). */
  id: string
  videoId: string
  title: string
  author: string | null
  /** Set by the first app whose player knows it. */
  durationS: number | null
  addedBy: string
}

export interface MusicPlayback {
  playing: boolean
  /** Seconds into the song at server time `at` (ms). */
  position: number
  at: number
  seq: number
}

export type MusicEventKind = 'add' | 'playlist' | 'previous' | 'play' | 'pause' | 'skip' | 'seek' | 'remove' | 'stop' | 'unplayable' | 'ended'
export interface MusicState {
  channelId: string
  /** null: nothing playing (the queue may still be empty). */
  now: MusicTrack | null
  /** What comes next, in order. */
  queue: MusicTrack[]
  playback: MusicPlayback
  /** Server clock when this was sent (ms): the app's offset to the shared clock. */
  serverNow: number
  /** What just happened, for the one line under the player ("Ana pulou"). */
  last: { kind: MusicEventKind; by: string | null; title: string | null; count?: number } | null
  /** Songs that already played and "voltar" can bring back. Absent on older servers (they have no "voltar"). */
  previous?: number
}

export type MusicErrorReason = 'disabled' | 'not_in_call' | 'invalid_link' | 'unavailable' | 'not_embeddable' | 'queue_full' | 'slow_down' | 'not_found'

export type MusicClientFrame =
  | { op: 'music_hello'; channelId: string }
  | { op: 'music_add'; channelId: string; url: string }
  | { op: 'music_add_many'; channelId: string; videoIds: string[]; replace: boolean; label: string; listId?: string }
  | { op: 'music_control'; channelId: string; action: 'play' | 'pause' | 'skip' | 'previous' | 'seek' | 'stop'; position?: number }
  | { op: 'music_remove'; channelId: string; trackId: string }
  | { op: 'music_report'; channelId: string; trackId: string; kind: 'ended' | 'unplayable' | 'duration'; durationS?: number }

const uuid = z.uuid()
export const MusicClientFrameSchema = z.discriminatedUnion('op', [
  /** Ask for the MUSIC_STATE of a call I am in (after joining or reconnecting). */
  z.object({ op: z.literal('music_hello'), channelId: uuid }),
  z.object({ op: z.literal('music_add'), channelId: uuid, url: z.string().min(1).max(2048) }),
  /** A playlist (saved, or read from a YouTube playlist link): `replace` clears what plays; `label` names it in "last". */
  z.object({
    op: z.literal('music_add_many'), channelId: uuid, videoIds: z.array(z.string().regex(YT_ID)).min(1).max(PLAYLIST_MAX_ITEMS),
    replace: z.boolean(), label: z.string().trim().min(1).max(PLAYLIST_NAME_MAX),
    /** A YouTube playlist link's list: its own name is said instead of `label` when YouTube knows it. */
    listId: z.string().regex(YT_LIST).optional(),
  }),
  z.object({
    op: z.literal('music_control'), channelId: uuid, action: z.enum(['play', 'pause', 'skip', 'previous', 'seek', 'stop']),
    position: z.number().finite().min(0).max(24 * 3600).optional(),
  }),
  z.object({ op: z.literal('music_remove'), channelId: uuid, trackId: uuid }),
  /** What a player saw: the song ended, cannot play outside YouTube, or how long it is. */
  z.object({
    op: z.literal('music_report'), channelId: uuid, trackId: uuid, kind: z.enum(['ended', 'unplayable', 'duration']),
    durationS: z.number().finite().min(0).max(24 * 3600).optional(),
  }),
])

/** Where the song is at `serverNow` (ms): frozen until `at`, then 1 s per second, never past the end. */
export function musicPosition(p: MusicPlayback, serverNow: number, durationS: number | null): number {
  const pos = p.playing && serverNow > p.at ? p.position + (serverNow - p.at) / 1000 : p.position
  return durationS === null ? Math.max(0, pos) : Math.min(Math.max(pos, 0), durationS)
}
