import { useLayoutEffect, useState, type CSSProperties } from 'react'

// The sidebar starts after the rail (--rail-w 64) and the user panel has an 8 px margin (shell.module.css .dock).
const LEFT = 72
const DOCK_MARGIN = 8
const GAP = 8
/** Title bar (40) plus a little air above the card. */
const TOP = 48

/**
 * Where the card and the crash offer sit: on top of the user panel, which grows with the voice panel during a call.
 * From the panel's own height, not its on-screen rectangle: changing space remounts the sidebar (a new panel element)
 * and slides it in with a transform, and neither may move the card.
 */
export function useAnchor(): CSSProperties {
  const [at, setAt] = useState<CSSProperties>({ left: LEFT, bottom: 76 })
  useLayoutEffect(() => {
    let watched: Element | null = null
    const place = () => {
      const dock = document.querySelector<HTMLElement>('[data-user-dock]')
      if (!dock?.offsetHeight) return // between two sidebars: keep the last position
      if (dock !== watched) {
        ro.disconnect()
        ro.observe(watched = dock)
      }
      const bottom = dock.offsetHeight + DOCK_MARGIN + GAP
      setAt({ left: LEFT, bottom, '--fb-max': `${Math.max(240, window.innerHeight - bottom - TOP)}px` } as CSSProperties)
    }
    // Fires when the panel grows (voice panel) and when its element is replaced (the old one collapses to nothing).
    const ro = new ResizeObserver(place)
    place()
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])
  return at
}
