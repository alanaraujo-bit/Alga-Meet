// Which screen the room shows and how lit it is (spec §7.1 "o tema é a luz", §7.3). Pure: the room derives it from the
// session, its seat and the server clock; every screen and the light level come from here.
import type { CinemaSessionView } from '@alga/shared'

export type RoomScreen = 'card' | 'sheet' | 'foyer' | 'countdown' | 'watching' | 'paused' | 'waiting' | 'intermission' | 'credits' | 'ended'
export type Lights = 'on' | 'dim' | 'half' | 'rising'
export interface RoomView { screen: RoomScreen; lights: Lights; who: string | null; nextUpS: number | null }

/** A pause longer than this becomes the intermission (client side, spec §7.3.8). */
export const INTERMISSION_MS = 180_000
/** Without a credits chapter, the credits are the last 30 s. */
export const CREDITS_TAIL_S = 30
/** "Próximo: … em 10 s" from the moment the credits start. */
export const NEXT_UP_S = 10
/** A start/seek that is still preparing after this shows the waiting screen; a quick one stays dark. */
export const BUFFERING_GRACE_MS = 1_500

const v = (screen: RoomScreen, lights: Lights, who: string | null = null, nextUpS: number | null = null): RoomView => ({ screen, lights, who, nextUpS })

export function roomView(i: {
  session: CinemaSessionView | null
  seated: boolean
  draft: boolean
  ended: boolean
  serverNow: number
  /** Server time the current user pause began (the pause's own `at`), null when not paused by someone. */
  pausedSince: number | null
  durationS: number
  /** Start of the credits chapter, if the film has one. */
  creditsAtS: number | null
  /** Where the room is now (film seconds). */
  position: number
}): RoomView {
  if (i.ended) return v('ended', 'rising')
  const s = i.session
  if (!s) return v(i.draft ? 'sheet' : 'card', 'on')
  if (!i.seated) return v('card', 'on')
  const p = s.playback
  switch (p.reason) {
    case 'foyer':
      return v('foyer', 'on')
    case 'host_away':
      return v('paused', 'half', s.hostId)
    case 'waiting':
      return v('waiting', 'half', p.waitingFor[0] ?? null)
    case 'buffering':
      // start/seek: everyone prepares; dark at once, the waiting screen only if it takes a while
      return i.serverNow - p.at > BUFFERING_GRACE_MS ? v('waiting', 'half') : v('watching', 'dim')
  }
  if (p.playing) {
    if (p.countdown && i.serverNow < p.at) return v('countdown', 'dim')
    const credits = i.creditsAtS ?? Math.max(0, i.durationS - CREDITS_TAIL_S)
    if (i.position >= credits) return v('credits', 'dim', null, Math.max(0, Math.ceil(credits + NEXT_UP_S - i.position)))
    return v('watching', 'dim')
  }
  if (i.pausedSince !== null && i.serverNow - i.pausedSince > INTERMISSION_MS) return v('intermission', 'on', p.by)
  return v('paused', 'half', p.by)
}

/** Where the credits start: a chapter named like credits, else null (the last CREDITS_TAIL_S then). */
export function creditsAt(chapters: { startS: number; title: string }[]): number | null {
  return chapters.find((c) => /^(end\s*)?(credits|cr[eé]ditos|ending|encerramento|ed)\b/i.test(c.title.trim()))?.startS ?? null
}

/** "Duna Parte Dois (2024)" → name and year (shown lighter), else the whole title. */
export function splitTitle(title: string): { name: string; year: string | null } {
  const m = /^(.*\S)\s*\((\d{4})\)\s*$/.exec(title)
  return m ? { name: m[1]!, year: m[2]! } : { name: title, year: null }
}
