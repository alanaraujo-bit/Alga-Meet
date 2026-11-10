import { useSyncExternalStore } from 'react'

/** Elements that cannot hold the floating UI as children. */
const LEAF = new Set(['VIDEO', 'CANVAS', 'IMG', 'IFRAME', 'AUDIO'])

/**
 * Where menus, tooltips, popovers, dialogs and toasts are mounted. Normally the body; while an element is in
 * fullscreen (the cinema room) only that element is drawn, so they go inside it or nobody sees them.
 */
export function portalTarget(doc: Pick<Document, 'fullscreenElement' | 'body'>): HTMLElement {
  const fs = doc.fullscreenElement
  return fs && !LEAF.has(fs.tagName) ? (fs as HTMLElement) : doc.body
}

const subscribe = (on: () => void) => {
  document.addEventListener('fullscreenchange', on)
  return () => document.removeEventListener('fullscreenchange', on)
}
const current = () => portalTarget(document)

/** The portal target, following fullscreen in and out (what is open moves with it). */
export const usePortalTarget = (): HTMLElement => useSyncExternalStore(subscribe, current, current)
