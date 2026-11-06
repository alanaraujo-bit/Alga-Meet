import { z } from 'zod'

/**
 * Sala de Cinema: synchronized watch party inside a voice call (docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md,
 * §6.2 gateway, §6.6 sync). The host's main process turns a local file into a CinemaFilm (metadata only: the local path
 * never leaves it) plus pieces (init segment + media segments) that the peers swap over their own RTCPeerConnections.
 * The server only keeps the session (playback clock, seats, piece index, signaling relay); it never sees media bytes.
 *
 * Piece numbering per track (CinemaPieceMeta): piece 0 of every video/audio track is its init segment (startS = -1,
 * durS = 0); media pieces start at n = 1. Single-file tracks (`s<id>`, `poster`, `thumbs`) are one piece n = 0
 * (startS 0, durS 0).
 */

export const CINEMA_MAX_SEATS = 8
/** Longest film a host can announce (24 h): bounds what the server allocates per film (heat is one slot per 10 s). */
export const CINEMA_MAX_DURATION_S = 86_400
/** Scheduled commands (play/pause/seek) take effect this long after the server stamps them, so every client can arm. */
export const CINEMA_LEAD_MS = 250
export const CINEMA_HOST_AWAY_MS = 120_000
export const CINEMA_STALL_MS = 2_000
export const CINEMA_RESUME_AHEAD_S = 10
export const CINEMA_SEEK_READY_S = 3
export const CINEMA_READY_TIMEOUT_MS = 10_000
export const CINEMA_COUNTDOWN_AFTER_PAUSE_MS = 15_000
export const CINEMA_COUNTDOWN_MS = 3_000
export const CINEMA_STATUS_INTERVAL_MS = 2_000
/** cinema_* frames per socket per 60 s, counted apart from the general gateway quota. */
export const CINEMA_FRAME_LIMIT = 300
/** Raw size of one cinema_* gateway frame (same as the general limit). */
export const CINEMA_MAX_FRAME_BYTES = 16 * 1024
/** Sized so a worst-case cinema_pieces frame (~95 B per item) stays under CINEMA_MAX_FRAME_BYTES. */
export const CINEMA_ITEMS_PER_FRAME = 120
export const CINEMA_REACTIONS = ['😂', '😱', '😍', '😭', '🔥', '👏'] as const
export const CINEMA_REACTION_RATE = { perSecond: 1, burst: 5 } as const
/** Lifetime of the TURN credentials handed out with a session. */
export const CINEMA_TURN_TTL_S = 21_600
/** RTCPeerConnections per pair of seats: one SCTP association each, since loss and a bloated queue cap each one's rate (§6.4). */
export const CINEMA_LANES = 3

const MAX_PIECE_BYTES = 64 * 1024 * 1024
const MAX_SDP_CHARS = 12_000
const MAX_ICE_CANDIDATES = 20

export type CinemaReaction = (typeof CINEMA_REACTIONS)[number]
export type CinemaTrackId = 'v' | `a${number}` | `s${number}` | 'poster' | 'thumbs'
export interface CinemaAudioTrack { id: number; lang: string | null; title: string | null; sourceCodec: string; channels: number; out: 'copy' | 'aac' | 'opus' | 'flac'; mime: string; default: boolean }
export interface CinemaSubtitleTrack { id: number; lang: string | null; title: string | null; format: 'vtt' | 'ass'; external: boolean }
export interface CinemaFilm {
  title: string; durationS: number; width: number; height: number
  hdr: 'sdr' | 'hdr10' | 'hlg' | 'dv8'
  videoCodec: 'h264' | 'hevc' | 'av1' | 'vp9'; videoMime: string; bitrateKbps: number
  audio: CinemaAudioTrack[]; subtitles: CinemaSubtitleTrack[]
  chapters: { startS: number; title: string }[]
  episode: { season: number; episode: number } | null
}
/** [startS, durS, bytes, sha256 hex] of piece n of a track. */
export type CinemaPieceMeta = [number, number, number, string]
export interface CinemaPlayback {
  playing: boolean; position: number; at: number; seq: number; by: string | null
  reason: 'foyer' | 'user' | 'buffering' | 'waiting' | 'host_away'
  waitingFor: string[]; countdown: boolean
}
export interface CinemaSeat { userId: string; status: 'preparing' | 'ready' | 'stalled' | 'unsupported'; aheadS: number; direct: boolean }
export interface CinemaIceServer { urls: string[]; username?: string; credential?: string }
export interface CinemaSessionView {
  sessionId: string; channelId: string; hostId: string; film: CinemaFilm
  playback: CinemaPlayback; seats: CinemaSeat[]
  options: { controlLock: boolean; waitForStalled: boolean }
  iceServers: CinemaIceServer[]; createdAt: number
  /** Reactions per 10 s of film (ceil(durationS / 10) slots), same buckets as the summary's peak. */
  heat: number[]
}
export interface CinemaSummary { watchedS: number; seats: string[]; reactions: number; peak: { position: number; count: number } | null }
export type CinemaEndReason = 'host_ended' | 'host_left' | 'moderator' | 'call_empty' | 'channel_gone'
export type CinemaErrorReason = 'disabled' | 'not_in_call' | 'forbidden' | 'exists' | 'full' | 'not_found' | 'locked' | 'stale' | 'not_seated' | 'invalid'
/** `lane`: which of the pair's CINEMA_LANES connections the signal is for (absent = 0). */
export type CinemaSignal =
  | { kind: 'offer' | 'answer'; sdp: string; tag?: string; epoch?: number; lane?: number }
  | { kind: 'ice'; candidates: string[]; lane?: number }
export type CinemaClientFrame =
  | { op: 'cinema_time'; c: number }
  | { op: 'cinema_hello' }
  | { op: 'cinema_open'; channelId: string; film: CinemaFilm; startS: number }
  | { op: 'cinema_pieces'; sessionId: string; track: CinemaTrackId; from: number; items: CinemaPieceMeta[] }
  | { op: 'cinema_film'; sessionId: string; title?: string; addSubtitle?: CinemaSubtitleTrack }
  | { op: 'cinema_seat'; sessionId: string; seated: boolean }
  | { op: 'cinema_status'; sessionId: string; status: CinemaSeat['status']; aheadS: number }
  | { op: 'cinema_control'; sessionId: string; action: 'start' | 'play' | 'pause' | 'seek' | 'continue_without'; position?: number; target?: string; seq: number }
  | { op: 'cinema_options'; sessionId: string; controlLock?: boolean; waitForStalled?: boolean }
  | { op: 'cinema_signal'; sessionId: string; to: string; signal: CinemaSignal }
  | { op: 'cinema_react'; sessionId: string; emoji: CinemaReaction }
  | { op: 'cinema_end'; sessionId: string }
  | { op: 'cinema_switch'; sessionId: string; film: CinemaFilm; startS: number }

// ---- gateway schema --------------------------------------------------------------------------------------------------

const uuid = z.uuid()
const seconds = z.number().finite().min(0)
const nonNegInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const text = (max: number) => z.string().max(max)
const trackId = z.custom<CinemaTrackId>((v) => typeof v === 'string' && /^(v|poster|thumbs|[as]\d{1,3})$/.test(v), 'track id')

const AudioTrackSchema = z.object({
  id: nonNegInt, lang: text(16).nullable(), title: text(120).nullable(), sourceCodec: text(32),
  channels: z.number().int().min(1).max(32), out: z.enum(['copy', 'aac', 'opus', 'flac']), mime: text(200), default: z.boolean(),
})
const SubtitleTrackSchema = z.object({
  id: nonNegInt, lang: text(16).nullable(), title: text(120).nullable(), format: z.enum(['vtt', 'ass']), external: z.boolean(),
})
const FilmSchema = z.object({
  title: z.string().min(1).max(120),
  durationS: seconds.max(CINEMA_MAX_DURATION_S), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384),
  hdr: z.enum(['sdr', 'hdr10', 'hlg', 'dv8']),
  videoCodec: z.enum(['h264', 'hevc', 'av1', 'vp9']), videoMime: text(200), bitrateKbps: z.number().finite().min(0),
  audio: z.array(AudioTrackSchema).max(32), subtitles: z.array(SubtitleTrackSchema).max(64),
  chapters: z.array(z.object({ startS: seconds, title: text(120) })).max(100),
  episode: z.object({ season: nonNegInt, episode: nonNegInt }).nullable(),
})
/** The film as the host sends it; also what the host-side probe mapping is validated against. */
export const CinemaFilmSchema = FilmSchema
/** startS may be exactly -1 (init segment); anything below is invalid. */
const PieceMetaSchema = z.tuple([
  z.number().finite().min(-1),
  seconds,
  z.number().int().min(1).max(MAX_PIECE_BYTES),
  z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex'),
])
const lane = z.number().int().min(0).max(CINEMA_LANES - 1).optional()
const SignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['offer', 'answer']), sdp: z.string().max(MAX_SDP_CHARS), tag: text(64).optional(), epoch: nonNegInt.optional(), lane }),
  z.object({ kind: z.literal('ice'), candidates: z.array(text(512)).max(MAX_ICE_CANDIDATES), lane }),
])

export const CinemaClientFrameSchema = z.discriminatedUnion('op', [
  /** Clock sample: `c` = client clock; the server answers CINEMA_PONG { c, s }. */
  z.object({ op: z.literal('cinema_time'), c: z.number().finite() }),
  /** Ask for the current CINEMA_STATE of the caller's call (after connect/reconnect). */
  z.object({ op: z.literal('cinema_hello') }),
  z.object({ op: z.literal('cinema_open'), channelId: uuid, film: FilmSchema, startS: seconds }),
  /** `from` may be <= the indexed length (regeneration overwrites): the server decides. */
  z.object({ op: z.literal('cinema_pieces'), sessionId: uuid, track: trackId, from: nonNegInt, items: z.array(PieceMetaSchema).max(CINEMA_ITEMS_PER_FRAME) }),
  z.object({ op: z.literal('cinema_film'), sessionId: uuid, title: z.string().min(1).max(120).optional(), addSubtitle: SubtitleTrackSchema.optional() }),
  z.object({ op: z.literal('cinema_seat'), sessionId: uuid, seated: z.boolean() }),
  z.object({ op: z.literal('cinema_status'), sessionId: uuid, status: z.enum(['preparing', 'ready', 'stalled', 'unsupported']), aheadS: seconds }),
  z.object({
    op: z.literal('cinema_control'), sessionId: uuid,
    action: z.enum(['start', 'play', 'pause', 'seek', 'continue_without']),
    position: seconds.optional(), target: uuid.optional(), seq: nonNegInt,
  }),
  z.object({ op: z.literal('cinema_options'), sessionId: uuid, controlLock: z.boolean().optional(), waitForStalled: z.boolean().optional() }),
  z.object({ op: z.literal('cinema_signal'), sessionId: uuid, to: uuid, signal: SignalSchema }),
  z.object({ op: z.literal('cinema_react'), sessionId: uuid, emoji: z.enum(CINEMA_REACTIONS) }),
  z.object({ op: z.literal('cinema_end'), sessionId: uuid }),
  /** Host only: next episode in the same session (same seats); clears the piece index, reactions and heat. */
  z.object({ op: z.literal('cinema_switch'), sessionId: uuid, film: FilmSchema, startS: seconds }),
])

/** Where the shared timeline is at `serverNow` (server clock, ms): frozen until `at`, then advancing 1 s per second. */
export function positionAt(p: CinemaPlayback, serverNow: number, durationS: number): number {
  const pos = p.playing && serverNow > p.at ? p.position + (serverNow - p.at) / 1000 : p.position
  return Math.min(Math.max(pos, 0), durationS)
}
