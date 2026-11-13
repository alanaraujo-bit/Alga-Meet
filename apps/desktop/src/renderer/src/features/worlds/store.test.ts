import type { Dispatch, WorldRoomView, WorldSession } from '@alga/shared'
import { STARTER_ROOM } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners: Array<(d: Dispatch) => void> = []
const sent: Array<{ op: string } & Record<string, unknown>> = []
const session: { worlds: { assetsUrl: string } | null; send: (f: never) => boolean } = {
  worlds: { assetsUrl: '/api/v1/worlds/assets' },
  send: (f) => (sent.push(f), true),
}
vi.mock('@/store/session', () => ({
  onDispatch: (fn: (d: Dispatch) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
  useSession: { getState: () => session },
}))
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
})

const { useData } = await import('@/store/data')
const w = await import('./store')
const { useWorlds } = w

const CH = '0190f3a2-7b4c-7d00-8000-0000000000aa'
const OTHER = '0190f3a2-7b4c-7d00-8000-0000000000bb'
const dispatch = (d: Dispatch) => {
  for (const l of [...listeners]) l(d)
}
const inCall = (channelId: string | null) =>
  useData.setState((st) => ({ voiceStates: channelId ? { me: { userId: 'me', channelId } } : {}, me: { ...(st.me ?? {}), id: 'me' } }) as never)
const world = (members: string[] = [], o: Partial<WorldSession> = {}): WorldSession => ({
  channelId: CH, place: { kind: 'lounge' }, hostId: 'ana', tv: null, seq: 1,
  members: members.map((userId, k) => ({ userId, k, pose: [0, 0, 0, 0], seat: null, loop: null })), ...o,
})
const state = (s: WorldSession | null, channelId = CH): Dispatch => ({ t: 'WORLD_STATE', d: { channelId, session: s } })
const room = (rev = 1): WorldRoomView => ({ ...STARTER_ROOM, channelId: CH, place: { kind: 'lounge' }, name: 'Lounge', rev })
const ops = () => sent.map((f) => f.op)

let stop: () => void = () => {}
beforeEach(() => {
  stop()
  sent.length = 0
  session.worlds = { assetsUrl: '/api/v1/worlds/assets' }
  w._test.reset()
  inCall(null)
  stop = w.startWorlds()
})

describe('following the world of my call', () => {
  it('asks for it when I enter a call, keeps what the server says, forgets it when I leave', () => {
    inCall(CH)
    expect(sent).toEqual([{ op: 'world_hello', channelId: CH }])
    dispatch(state(world(['ana'])))
    dispatch({ t: 'WORLD_ROOM', d: room() })
    expect(useWorlds.getState().session?.members).toHaveLength(1)
    expect(useWorlds.getState().room?.name).toBe('Lounge')
    inCall(null)
    expect(useWorlds.getState()).toMatchObject({ session: null, room: null, show: false })
  })

  it('ignores the world of another call, and never sends on a server without Worlds', () => {
    inCall(CH)
    dispatch(state(world(['ana'], { channelId: OTHER }), OTHER))
    expect(useWorlds.getState().session).toBeNull()
    stop()
    session.worlds = null
    sent.length = 0
    stop = w.startWorlds()
    inCall(OTHER)
    w.openWorld({ kind: 'lounge' })
    w.enterWorld()
    w.sendMove([0, 0, 0, 1])
    expect(sent).toEqual([])
  })
})

describe('walking in', () => {
  it('opening a world walks me in once it exists, and shows it on the stage', () => {
    inCall(CH)
    sent.length = 0
    w.openWorld({ kind: 'lounge' })
    expect(ops()).toEqual(['world_open'])
    expect(useWorlds.getState()).toMatchObject({ entering: true, show: true })
    // The server announces the session: I am not in it yet.
    dispatch(state(world()))
    expect(ops()).toEqual(['world_open', 'world_enter'])
    // A second state before I am in does not ask twice.
    dispatch(state(world([], { seq: 2 })))
    expect(ops()).toEqual(['world_open', 'world_enter'])
    dispatch(state(world(['me'], { seq: 3 })))
    expect(useWorlds.getState()).toMatchObject({ entering: false, show: true })
    expect(w.amInside(useWorlds.getState(), 'me')).toBe(true)
  })

  it('walking into a world someone else opened is one frame', () => {
    inCall(CH)
    dispatch(state(world(['ana'])))
    sent.length = 0
    w.enterWorld()
    expect(ops()).toEqual(['world_enter'])
    dispatch(state(world(['ana'], { seq: 2 })))
    expect(ops()).toEqual(['world_enter'])
  })

  it('refused at the door: says why once, and the stage goes back to the call', () => {
    inCall(CH)
    dispatch(state(world(['ana'], { place: { kind: 'room', ownerId: 'ana' } })))
    w.enterWorld()
    dispatch({ t: 'WORLD_ERROR', d: { op: 'world_enter', reason: 'friends_only' } })
    expect(useWorlds.getState()).toMatchObject({ entering: false, show: false })
    expect(useWorlds.getState().notice).toMatch(/amigos/)
    // No more walking in by itself after that.
    sent.length = 0
    dispatch(state(world(['ana'], { seq: 2 })))
    expect(sent).toEqual([])
  })

  it('a new gateway session asks again and walks me back in', () => {
    inCall(CH)
    w.openWorld({ kind: 'lounge' })
    dispatch(state(world(['me'])))
    sent.length = 0
    dispatch({ t: 'READY', d: { worlds: { assetsUrl: '/x' } } } as Dispatch)
    expect(ops()).toEqual(['world_hello'])
    // The server forgot me with the old socket.
    dispatch(state(world([], { seq: 9 })))
    expect(ops()).toEqual(['world_hello', 'world_enter'])
  })
})

describe('stepping out', () => {
  it('leaving tells the server and shows the call; looking at the call does not leave', () => {
    inCall(CH)
    w.openWorld({ kind: 'lounge' })
    dispatch(state(world(['me'])))
    sent.length = 0
    w.showWorld(false)
    expect(sent).toEqual([])
    expect(useWorlds.getState().show).toBe(false)
    w.showWorld(true)
    w.leaveWorld()
    expect(ops()).toEqual(['world_leave'])
    expect(useWorlds.getState().show).toBe(false)
    // Nobody inside any more: nothing pulls me back in.
    dispatch(state(world([], { seq: 2 })))
    expect(ops()).toEqual(['world_leave'])
  })

  it('taken out by the server (the room became private): told why, back on the call', () => {
    inCall(CH)
    w.openWorld({ kind: 'lounge' })
    dispatch(state(world(['me'])))
    dispatch({ t: 'WORLD_REMOVED', d: { channelId: CH, reason: 'locked' } })
    expect(useWorlds.getState()).toMatchObject({ show: false, entering: false })
    expect(useWorlds.getState().notice).toMatch(/trancada/)
  })

  it('the 3D room failing steps me out and leaves nothing waiting', () => {
    inCall(CH)
    w.openWorld({ kind: 'lounge' })
    dispatch(state(world(['me'])))
    sent.length = 0
    w.worldFailed()
    expect(ops()).toEqual(['world_leave'])
    expect(useWorlds.getState()).toMatchObject({ show: false, entering: false })
  })

  it('the world ending (the call emptied, the channel was deleted) clears the stage', () => {
    inCall(CH)
    w.openWorld({ kind: 'lounge' })
    dispatch(state(world(['me'])))
    dispatch({ t: 'WORLD_ROOM', d: room() })
    dispatch(state(null))
    expect(useWorlds.getState()).toMatchObject({ session: null, room: null, show: false, entering: false })
  })
})

describe('quality', () => {
  it('remembers the choice on this computer', () => {
    w.setQuality('low')
    expect(useWorlds.getState().quality).toBe('low')
    expect(JSON.parse(store.get('alga.worlds.v1')!)).toEqual({ quality: 'low' })
  })
})
