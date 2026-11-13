// The Ateliê: where a person arranges their room, dresses their figure and sees what is sold for both. Only whether it
// is open lives here, so opening it from anywhere costs nothing; the screen itself (and the 3D engine) is a lazy chunk.
import type { Me, PutWorldRoomBody, WorldAvatar, WorldRoom } from '@alga/shared'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useData } from '@/store/data'

export type StudioTab = 'room' | 'avatar' | 'store'

export const useStudio = create<{ tab: StudioTab | null }>(() => ({ tab: null }))
export const openStudio = (tab: StudioTab = 'room'): void => useStudio.setState({ tab })
export const closeStudio = (): void => useStudio.setState({ tab: null })

export const getMyRoom = (): Promise<WorldRoom> => api<WorldRoom>('GET', '/worlds/rooms/@me')
export const putMyRoom = (body: PutWorldRoomBody): Promise<WorldRoom> => api<WorldRoom>('PUT', '/worlds/rooms/@me', body)

/** Saves the figure (null = back to the automatic one). The server answers with Me and tells everyone else. */
export async function putAvatar(avatar: WorldAvatar | null): Promise<void> {
  const me = await api<Me>('PUT', '/worlds/avatar', { avatar })
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
}
