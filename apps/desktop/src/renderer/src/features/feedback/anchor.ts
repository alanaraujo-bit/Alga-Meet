import { useLayoutEffect, useState, type CSSProperties } from 'react'

/** Where the card and the crash offer sit: on top of the user panel (which grows with the voice panel during a call). */
export function useAnchor(): CSSProperties {
  const [at, setAt] = useState<CSSProperties>({ left: 72, bottom: 68 })
  useLayoutEffect(() => {
    const dock = document.querySelector<HTMLElement>('[data-user-dock]')
    if (!dock) return
    const place = () => {
      const r = dock.getBoundingClientRect()
      setAt({ left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.top + 8) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(dock)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [])
  return at
}
