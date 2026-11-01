import { create } from 'zustand'
import { api } from '@/lib/api'

/**
 * Staff panel (moderation). `Me` does not say who is staff (users.staff_role never leaves the server), so the shell
 * asks the admin API once per sign-in: 200 = staff. A 403 is answered before the server's audit hook, so the probe
 * leaves no trace for everyone else; for staff it is one logged read.
 */
export const useStaff = create<{ isStaff: boolean; open: boolean }>()(() => ({
  isStaff: false,
  open: false,
}))

export async function probeStaff(): Promise<void> {
  useStaff.setState({ isStaff: false, open: false })
  const ok = await api('GET', '/admin/reports?limit=1').then(
    () => true,
    () => false,
  )
  useStaff.setState({ isStaff: ok })
}
export const openStaff = () => useStaff.getState().isStaff && useStaff.setState({ open: true })
export const closeStaff = () => useStaff.setState({ open: false })
