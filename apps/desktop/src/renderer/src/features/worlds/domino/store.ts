// The domino tables of the world I am in, as the server lets me see each (WORLD_DOMINO): my own tiles named, the
// others counted. Only on a server whose READY says it plays dominoes; an older one closes the socket on these ops.
import type { DominoClientFrame, DominoView } from '@alga/shared'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'

interface DominoStore {
  /** By table id: the server's latest word. */
  tables: Record<string, DominoView>
  /** By table id: when that word arrived (performance.now), which is what its `auto.ms` counts from. */
  at: Record<string, number>
  /** Grows when a play of mine was refused: the room shows the table as the server has it again. */
  rev: number
}

export const useDomino = create<DominoStore>(() => ({ tables: {}, at: {}, rev: 0 }))

const myChannel = (): string | null => {
  const st = useData.getState()
  return (st.me && st.voiceStates[st.me.id]?.channelId) ?? null
}
type Body<F> = F extends unknown ? Omit<F, 'channelId'> : never
function send(frame: Body<DominoClientFrame>): void {
  const channelId = myChannel()
  if (channelId && useSession.getState().worlds?.domino) useSession.getState().send({ ...frame, channelId } as DominoClientFrame)
}

export const dominoStart = (table: string): void => send({ op: 'world_domino_start', table })
export const dominoBot = (table: string, add: boolean): void => send({ op: 'world_domino_bot', table, add })
export const dominoPlay = (table: string, seq: number, tile: number, end: 0 | 1): void => send({ op: 'world_domino_play', table, seq, tile, end })

/** The server said no to a play the room had already shown. */
export const dominoRefused = (): void => useDomino.setState((s) => ({ rev: s.rev + 1 }))

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = map
  return rest
}

/** Applies a WORLD_DOMINO to the store. Exported for the tests. */
export function applyDomino(table: string, game: DominoView | null, now = performance.now()): void {
  useDomino.setState((s) => (game
    ? { tables: { ...s.tables, [table]: game }, at: { ...s.at, [table]: now } }
    : { tables: without(s.tables, table), at: without(s.at, table) }))
}

/** Subscribes to the gateway. Returns the function that undoes it. */
export function startDomino(): () => void {
  let channel = myChannel()
  const reset = (): void => useDomino.setState({ tables: {}, at: {} })
  const offs = [
    onDispatch((d) => {
      if (d.t === 'READY') return reset()
      if (d.t === 'WORLD_DOMINO') {
        if (d.d.channelId === myChannel()) applyDomino(d.d.table, d.d.game)
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
