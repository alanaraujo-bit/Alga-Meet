import { create } from 'zustand'
import { useData } from '../../store/data'

/** Staff panel (moderation), for accounts whose `Me.staffRole` is set (granted only by apps/server/scripts/grant-staff.ts). */
export const useStaff = create<{ open: boolean }>()(() => ({ open: false }))

export const isStaff = () => !!useData.getState().me?.staffRole
export const openStaff = () => isStaff() && useStaff.setState({ open: true })
export const closeStaff = () => useStaff.setState({ open: false })
