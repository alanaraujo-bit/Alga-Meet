// The world of my call: what the server says (WORLD_STATE, WORLD_ROOM), whether I chose to see the call that way, and
// the commands. Only on a server whose READY says it has Worlds (an older one closes the socket on world_*). Nothing
// here touches the call itself: leaving the world, or the world failing, leaves voice and screen share as they were.
import {
  type WorldClientFrame, type WorldEmote, type WorldErrorReason, type WorldPlace, type WorldPose, type WorldRoomView, type WorldSession,
} from '@alga/shared'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import type { QualityPref } from './engine/quality'
import { errorText } from './strings'

const PREFS_KEY = 'alga.worlds.v1'

interface WorldsStore {
  /** The world of the call I am in; null = it has none. */
  session: WorldSession | null
  room: WorldRoomView | null
  /** I asked to walk in and the server has not answered yet. */
  entering: boolean
  /** The stage shows the 3D room (while I am inside). Off = the regular call, with me still in the room. */
  show: boolean
  /** One sentence: a refused action, or why I was taken out. Cleared by the next thing that works. */
  notice: string | null
  quality: QualityPref
  /** The picker of where to open the world is up. */
  picking: boolean
}

function savedQuality(): QualityPref {
  try {
    const q = (JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { quality?: unknown }).quality
    return q === 'low' || q === 'medium' || q === 'high' ? q : 'auto'
  } catch {
    return 'auto'
  }
}

export const useWorlds = create<WorldsStore>(() => ({ session: null, room: null, entering: false, show: false, notice: null, quality: savedQuality(), picking: false }))

const myChannel = (): string | null => {
  const st = useData.getState()
  return (st.me && st.voiceStates[st.me.id]?.channelId) ?? null
}
const myId = (): string | null => useData.getState().me?.id ?? null
export const worldsEnabled = (): boolean => useSession.getState().worlds !== null
const send = (f: WorldClientFrame): boolean => useSession.getState().send(f)

/** Whether I am one of the people in the room. */
export const amInside = (s: Pick<WorldsStore, 'session'>, meId: string | null | undefined): boolean =>
  !!meId && !!s.session?.members.some((m) => m.userId === meId)

/** I want in as soon as there is a session (set by open/enter, kept across a reconnect). */
let wantIn = false
/** world_enter already went out for this wish (one per socket: a reconnect asks again). */
let asked = false

function withChannel(fn: (channelId: string) => void): void {
  const channelId = myChannel()
  if (channelId && worldsEnabled()) fn(channelId)
}

export function setPicking(picking: boolean): void {
  useWorlds.setState({ picking })
}

/** Opens the call's world in a place (or moves it there) and walks in. */
export function openWorld(place: WorldPlace): void {
  withChannel((channelId) => {
    wantIn = true
    asked = false
    useWorlds.setState({ notice: null, picking: false, entering: true, show: true })
    send({ op: 'world_open', channelId, place })
  })
}

/** Walks into the world the call already has. */
export function enterWorld(): void {
  withChannel((channelId) => {
    wantIn = true
    asked = true
    useWorlds.setState({ notice: null, entering: true, show: true })
    send({ op: 'world_enter', channelId })
  })
}

/** Back to the regular call. The world stays open for the others. */
export function leaveWorld(): void {
  wantIn = false
  useWorlds.setState({ show: false, entering: false })
  withChannel((channelId) => send({ op: 'world_leave', channelId }))
}

/** Looks at the regular call for a moment without leaving the room (or back). */
export function showWorld(show: boolean): void {
  useWorlds.setState({ show })
}

export const sendMove = (p: WorldPose): void => withChannel((channelId) => send({ op: 'world_move', channelId, p }))
export const sit = (seat: string): void => withChannel((channelId) => send({ op: 'world_sit', channelId, seat }))
export const stand = (p: WorldPose): void => withChannel((channelId) => send({ op: 'world_stand', channelId, p }))
export const emote = (e: WorldEmote): void => withChannel((channelId) => send({ op: 'world_emote', channelId, emote: e }))
export const rest = (): void => withChannel((channelId) => send({ op: 'world_rest', channelId }))
export const setTv = (userId: string | null): void => withChannel((channelId) => send({ op: 'world_tv', channelId, userId }))

export function setQuality(quality: QualityPref): void {
  useWorlds.setState({ quality })
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ quality }))
  } catch {
    // Private mode or a full disk: the choice lasts until the app closes.
  }
}

export function dismissNotice(): void {
  useWorlds.setState({ notice: null })
}

/** The 3D room itself failed (no WebGL, the pack would not download): step out so the call screen is whole again. */
export function worldFailed(): void {
  wantIn = false
  useWorlds.setState({ show: false, entering: false })
  withChannel((channelId) => send({ op: 'world_leave', channelId }))
}

const hello = (): void => withChannel((channelId) => send({ op: 'world_hello', channelId }))

function refused(op: string, reason: WorldErrorReason): void {
  // Being refused at the door is not wanting in any more; a refused gesture changes nothing.
  if (op === 'world_enter' || op === 'world_open') {
    wantIn = false
    useWorlds.setState({ entering: false, show: amInside(useWorlds.getState(), myId()), notice: errorText(reason) })
  } else if (reason !== 'not_inside' && reason !== 'slow_down') {
    useWorlds.setState({ notice: errorText(reason) })
  }
}

/** Subscribes to the gateway. Returns the function that undoes it. */
export function startWorlds(): () => void {
  let channel = myChannel()
  if (channel) hello()
  const reset = () => useWorlds.setState({ session: null, room: null, entering: false, show: false, notice: null, picking: false })
  const offs = [
    onDispatch((d) => {
      // A new READY is a new socket: the server forgot I was inside. Ask again, and walk back in if I was.
      if (d.t === 'READY') {
        asked = false
        return d.d.worlds ? hello() : reset()
      }
      if (d.t === 'WORLD_STATE') {
        if (d.d.channelId !== myChannel()) return
        const session = d.d.session
        const inside = amInside({ session }, myId())
        if (!session) wantIn = false
        // The state that answers world_open (or a reconnect) comes before I am a member: walk in, once.
        if (session && wantIn && !inside && !asked) {
          asked = true
          send({ op: 'world_enter', channelId: d.d.channelId })
        }
        return useWorlds.setState((s) => ({
          session,
          room: session ? s.room : null,
          entering: !!session && wantIn && !inside,
          show: session ? s.show : false,
          notice: inside ? null : s.notice,
        }))
      }
      if (d.t === 'WORLD_ROOM') {
        if (d.d.channelId !== myChannel()) return
        return useWorlds.setState({ room: d.d })
      }
      if (d.t === 'WORLD_REMOVED') {
        if (d.d.channelId !== myChannel()) return
        wantIn = false
        return useWorlds.setState({ show: false, entering: false, notice: errorText(d.d.reason) })
      }
      if (d.t === 'WORLD_ERROR') refused(d.d.op, d.d.reason)
    }),
    useData.subscribe(() => {
      const c = myChannel()
      if (c === channel) return
      channel = c
      wantIn = false
      reset()
      if (c) hello()
    }),
  ]
  return () => {
    for (const off of offs) off()
    wantIn = false
    reset()
  }
}

/** Test seam. */
export const _test = { wantIn: () => wantIn, reset: () => { wantIn = false; asked = false } }
