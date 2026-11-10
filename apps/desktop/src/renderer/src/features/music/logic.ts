// Music in a call (packages/shared/src/music.ts): YouTube's embedded player driven by postMessage only (the app's CSP
// loads no outside script, so no IFrame API library), and the rule that keeps each player in step with the room.
import type { MusicErrorReason } from '@alga/shared'

/** Further than this from the room and the player jumps back (an ad, a stall, a late join). Music forgives a second. */
export const DRIFT_S = 1.5

/** The privacy-enhanced embed (no YouTube cookies until the person interacts with it). */
export function embedUrl(videoId: string, startS: number): string {
  const q = new URLSearchParams({
    enablejsapi: '1', autoplay: '1', controls: '0', disablekb: '1', fs: '0', rel: '0', playsinline: '1', iv_load_policy: '3',
    start: String(Math.max(0, Math.floor(startS))),
  })
  return `https://www.youtube-nocookie.com/embed/${videoId}?${q}`
}

export type PlayerFunc = 'playVideo' | 'pauseVideo' | 'seekTo' | 'loadVideoById' | 'setVolume' | 'unMute' | 'mute'
export const command = (func: PlayerFunc, args: unknown[] = []): string => JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' })
/** Sent until the player answers: then it reports its state and time on its own. */
export const LISTENING = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' })

/** -1 unstarted · 0 ended · 1 playing · 2 paused · 3 buffering · 5 cued (YouTube's numbers). */
export interface PlayerNews { state?: number; time?: number; duration?: number; error?: number }

export function parsePlayer(raw: unknown): PlayerNews {
  let d: unknown = raw
  if (typeof raw === 'string') {
    try {
      d = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!d || typeof d !== 'object') return {}
  const { event, info } = d as { event?: unknown; info?: unknown }
  if (event === 'onError' && typeof info === 'number') return { error: info }
  if (event === 'onStateChange' && typeof info === 'number') return { state: info }
  if ((event === 'infoDelivery' || event === 'initialDelivery') && info && typeof info === 'object') {
    const i = info as { playerState?: unknown; currentTime?: unknown; duration?: unknown }
    const out: PlayerNews = {}
    if (typeof i.playerState === 'number') out.state = i.playerState
    if (typeof i.currentTime === 'number') out.time = i.currentTime
    if (typeof i.duration === 'number' && i.duration > 0) out.duration = i.duration
    return out
  }
  return {}
}

/** 2 bad id · 5 cannot play in HTML5 · 100 removed or private: the song cannot play anywhere, skip it for the call. */
export const unplayable = (code: number): boolean => code === 2 || code === 5 || code === 100
/**
 * 101/150 "the owner forbids embedding" was already checked by the server (oEmbed) before the song got in, and 153 is a
 * missing Referer: at play time all three mean THIS app was refused. Said here only; never a skip for everyone.
 */
export const refusedHere = (code: number): boolean => code === 101 || code === 150 || code === 153

/** What to tell the player so it does what the room does. `time` null = not reported yet. */
export function decide(p: { shouldPlay: boolean; target: number; time: number | null; state: number }): Array<[PlayerFunc, unknown[]]> {
  if (p.time === null || p.state === -1 || p.state === 3) return []
  const off = Math.abs(p.time - p.target) > DRIFT_S
  if (!p.shouldPlay) {
    if (p.state === 1) return [['pauseVideo', []]]
    return off ? [['seekTo', [p.target, true]]] : []
  }
  if (p.state === 1) return off ? [['seekTo', [p.target, true]]] : []
  if (p.state === 0) return []
  return off ? [['seekTo', [p.target, true]], ['playVideo', []]] : [['playVideo', []]]
}

const ERRORS: Record<MusicErrorReason, string> = {
  invalid_link: 'Esse link não é de um vídeo do YouTube.',
  not_embeddable: 'O dono desse vídeo não deixa ele tocar fora do YouTube.',
  unavailable: 'Não achei esse vídeo. Ele pode ser privado ou ter sido removido.',
  queue_full: 'A fila está cheia (50 músicas).',
  slow_down: 'Calma, espere um instante antes de pôr outra.',
  not_in_call: 'Entre na call para tocar música.',
  not_found: 'Essa música já saiu da fila.',
  disabled: 'Este servidor ainda não toca música.',
}
export const errorText = (r: MusicErrorReason): string => ERRORS[r] ?? 'Não deu para tocar essa música.'
