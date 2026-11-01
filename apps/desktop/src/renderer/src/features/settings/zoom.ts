import { create } from 'zustand'

/** UI zoom steps walked by the Aparência stepper and Ctrl+= / Ctrl+- (main clamps to 0.8..1.5 and persists it). */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const

/** Ctrl+= (1) / Ctrl+- (-1): the next step that way, staying put at the ends; Ctrl+0 (0): 100 %. */
export function stepZoom(cur: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return 1
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) : ZOOM_STEPS.findLast((z) => z < cur - 0.001)
  return next ?? cur
}

/** null = not loaded yet, or main has no zoom bridge (older build). */
export const useZoom = create<{ factor: number | null }>()(() => ({ factor: null }))
const bridge = () => window.alga?.window?.zoom
const apply = (factor: number) => {
  useZoom.setState({ factor })
  // The native caption buttons do not zoom: tokens.css divides the title bar by this.
  document.documentElement.style.setProperty('--zoom', String(factor))
}

export function setZoom(factor: number): void {
  const z = bridge()
  if (!z) return
  apply(factor)
  z.set(factor).catch(() => void z.get().then(apply))
}

/** Loads the saved zoom and routes Ctrl+= / Ctrl+- / Ctrl+0 through setZoom (Electron's own zoom keys would not persist). */
export function startZoomKeys(): () => void {
  const z = bridge()
  if (!z) return () => undefined
  void z.get().then(apply)
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' ? -1 : e.key === '0' ? 0 : null
    if (dir === null) return
    e.preventDefault()
    setZoom(stepZoom(useZoom.getState().factor ?? 1, dir))
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
