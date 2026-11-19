import { useEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { useUi } from '@/store/ui'
import { depthOf, placeFor, type MobileTab } from './logic'

export { depthOf, type MobileTab }

interface MobileState {
  tab: MobileTab
  /** The channel or DM is pushed on top of its list (spaces: depth 2, dms: depth 1). */
  open: boolean
}

export const useMobile = create<MobileState>()(() => ({ tab: 'spaces', open: false }))

export function selectTab(tab: MobileTab) {
  const { tab: cur } = useMobile.getState()
  const ui = useUi.getState()
  // Tapping the tab you are on goes back to its root, like iOS and Android apps.
  if (tab === cur) {
    useMobile.setState({ open: false })
    if (tab === 'spaces' && ui.view.kind === 'space') ui.go({ kind: 'home' })
    return
  }
  useMobile.setState({ tab, open: false })
  if (tab === 'friends' || tab === 'you' || tab === 'dms') {
    if (ui.view.kind !== 'home') ui.go({ kind: 'home' })
  }
}

/** The back button and the edge swipe: through history, so the entry pushed for the screen goes with it. */
export function goBack() {
  const { tab, open } = useMobile.getState()
  if (depthOf(tab, useUi.getState().view, open) > 0) history.back()
}

/** One step back in the current tab's stack. Returns false at the root (nothing to go back to). */
function back(): boolean {
  const { tab, open } = useMobile.getState()
  const ui = useUi.getState()
  const depth = depthOf(tab, ui.view, open)
  if (depth === 0) return false
  if (tab === 'spaces' && depth === 2) useMobile.setState({ open: false })
  else {
    useMobile.setState({ open: false })
    ui.go({ kind: 'home' })
  }
  return true
}

/**
 * Keeps the layout in step with the view, and the browser's history with the stack, so Android's back button and the
 * iOS edge swipe of the browser pop a screen instead of leaving the app.
 */
export function useMobileRouting() {
  useEffect(() => {
    const unsub = useUi.subscribe((st, prev) => {
      if (st.view === prev.view) return
      const place = placeFor(st.view, prev.view)
      if (place) useMobile.setState(place)
    })
    let depth = 0
    const sync = () => {
      const { tab, open } = useMobile.getState()
      const next = depthOf(tab, useUi.getState().view, open)
      if (next > depth) for (let i = depth; i < next; i++) history.pushState({ alga: i + 1 }, '')
      depth = next
    }
    const unsubM = useMobile.subscribe(sync)
    const unsubU = useUi.subscribe(sync)
    const onPop = () => {
      depth = Math.max(0, depth - 1)
      back()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      unsub()
      unsubM()
      unsubU()
      window.removeEventListener('popstate', onPop)
    }
  }, [])
}

// The phone layout is for the PWA on a narrow screen; the desktop app keeps its layout at any zoom.
const QUERY = '(max-width: 760px)'
const mq = typeof matchMedia === 'function' ? matchMedia(QUERY) : null
const subscribe = (cb: () => void) => {
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}
export function useCompact(): boolean {
  const narrow = useSyncExternalStore(subscribe, () => mq?.matches ?? false)
  return narrow && window.alga?.config.shell === 'web'
}
