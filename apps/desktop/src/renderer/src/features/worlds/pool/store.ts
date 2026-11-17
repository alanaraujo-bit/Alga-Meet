// The pool tables of the world I am in: what the server says about each (WORLD_POOL) and what the screen says, which
// stays one shot behind while that shot is still being played out in the room (so the score does not give away where
// the balls are going). Only on a server whose READY says it plays pool; an older one closes the socket on these ops.
import type { PoolAim, PoolClientFrame, PoolShot, PoolState } from '@alga/shared'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'

interface PoolStore {
  /** By table id: the server's latest word. */
  tables: Record<string, PoolState>
  /** By table id: what the scoreboard shows. */
  shown: Record<string, PoolState>
}

export const usePool = create<PoolStore>(() => ({ tables: {}, shown: {} }))

const myChannel = (): string | null => {
  const st = useData.getState()
  return (st.me && st.voiceStates[st.me.id]?.channelId) ?? null
}
type Body<F> = F extends unknown ? Omit<F, 'channelId'> : never
function send(frame: Body<PoolClientFrame>): void {
  const channelId = myChannel()
  if (channelId && useSession.getState().worlds?.pool) useSession.getState().send({ ...frame, channelId } as PoolClientFrame)
}

export const poolJoin = (table: string): void => send({ op: 'world_pool_join', table })
export const poolLeave = (table: string): void => send({ op: 'world_pool_leave', table })
export const poolRack = (table: string): void => send({ op: 'world_pool_rack', table })
export const poolAim = (table: string, a: PoolAim): void => send({ op: 'world_pool_aim', table, a })
export const poolShot = (table: string, seq: number, shot: PoolShot, cue: [number, number] | undefined): void =>
  send({ op: 'world_pool_shot', table, seq, shot, ...(cue ? { cue } : {}) })

/** The room finished playing a shot: the scoreboard catches up with it. */
export function poolSettled(table: string, shot: number): void {
  usePool.setState((s) => {
    const now = s.tables[table]
    return now && now.shot >= shot && s.shown[table] !== now ? { shown: { ...s.shown, [table]: now } } : s
  })
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = map
  return rest
}

/** Applies a WORLD_POOL to the store. Exported for the tests. */
export function applyPool(table: string, pool: PoolState | null): void {
  usePool.setState((s) => {
    if (!pool) return { tables: without(s.tables, table), shown: without(s.shown, table) }
    const was = s.shown[table]
    // A shot that is rolling right now: the room plays it, and says when it is over.
    const rolling = !!pool.last && !!was && pool.shot === was.shot + 1 && (pool.last.age ?? 0) < pool.last.ms
    return { tables: { ...s.tables, [table]: pool }, shown: rolling ? s.shown : { ...s.shown, [table]: pool } }
  })
}

/** Subscribes to the gateway. Returns the function that undoes it. */
export function startPool(): () => void {
  let channel = myChannel()
  const reset = (): void => usePool.setState({ tables: {}, shown: {} })
  const offs = [
    onDispatch((d) => {
      if (d.t === 'READY') return reset()
      if (d.t === 'WORLD_POOL') {
        if (d.d.channelId === myChannel()) applyPool(d.d.table, d.d.pool)
      } else if (d.t === 'WORLD_STATE') {
        // No world, or I am not in it any more: nothing of its tables is mine to see.
        const me = useData.getState().me?.id
        if (d.d.channelId === myChannel() && !d.d.session?.members.some((m) => m.userId === me)) reset()
      }
    }),
    useData.subscribe(() => {
      const c = myChannel()
      if (c === channel) return
      channel = c
      reset()
    }),
  ]
  return () => {
    for (const off of offs) off()
    reset()
  }
}
