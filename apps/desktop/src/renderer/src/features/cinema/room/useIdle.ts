import { useEffect, useState } from 'react'

/** The room's interface hides after `ms` without the mouse or a key (spec §7.3.5); `enabled` false keeps it shown. */
export function useIdle(ms: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) return setIdle(false)
    let timer = setTimeout(() => setIdle(true), ms)
    const wake = () => {
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(() => setIdle(true), ms)
    }
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const e of evs) window.addEventListener(e, wake, true)
    return () => {
      clearTimeout(timer)
      for (const e of evs) window.removeEventListener(e, wake, true)
    }
  }, [ms, enabled])
  return idle
}
