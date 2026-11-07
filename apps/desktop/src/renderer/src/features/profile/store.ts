import { create } from 'zustand'

/**
 * Who the full profile is open for (null = closed). Its own module, apart from ProfileModal.tsx, so editing the
 * modal never re-creates the store under the buttons that open it (Vite HMR would split them in two).
 */
export const useProfileModal = create<{ userId: string | null; spaceId: string | null }>()(() => ({ userId: null, spaceId: null }))
export const openProfile = (userId: string, spaceId: string | null = null) => useProfileModal.setState({ userId, spaceId })
export const closeProfile = () => useProfileModal.setState({ userId: null })
