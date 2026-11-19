import type { View } from '@/store/ui'

/** The phone layout (MobileShell): four tabs, each a stack of screens. `View` (store/ui) stays the source of truth. */
export type MobileTab = 'spaces' | 'dms' | 'friends' | 'you'

/** How deep the current tab's stack is, from the view and `open`. */
export function depthOf(tab: MobileTab, view: View, open: boolean): number {
  if (tab === 'spaces') return view.kind === 'space' ? (open && view.channelId ? 2 : 1) : 0
  if (tab === 'dms') return view.kind === 'dm' && open ? 1 : 0
  return 0
}

/** Where a view change (a tap, a notification, an invite, a call) puts the phone layout. */
export function placeFor(view: View, prev: View): { tab: MobileTab; open: boolean } | null {
  if (view.kind === 'dm') return { tab: 'dms', open: true }
  if (view.kind === 'space' && view.channelId && (prev.kind !== 'space' || prev.channelId !== view.channelId)) return { tab: 'spaces', open: true }
  if (view.kind === 'space' && !view.channelId) return { tab: 'spaces', open: false }
  return null
}
