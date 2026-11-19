// PWA entry: install window.alga first (the renderer reads it at import time), then start the desktop renderer as is.
import { bridge, updateWaiting } from './bridge'
import './web.css'

window.alga = bridge
document.documentElement.dataset.shell = 'web'

// Chrome/Android/Edge offer "install" through this event; the app shows its own button (Você) and calls prompt().
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  ;(window as Window & { algaInstall?: Event }).algaInstall = e
  window.dispatchEvent(new Event('alga-installable'))
})

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').then((reg) => {
    const watch = (sw: ServiceWorker | null) =>
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) updateWaiting(sw)
      })
    if (reg.waiting && navigator.serviceWorker.controller) updateWaiting(reg.waiting)
    reg.addEventListener('updatefound', () => watch(reg.installing))
    // A phone keeps the PWA open for days: look for a new version when it comes back to the front.
    document.addEventListener('visibilitychange', () => !document.hidden && void reg.update().catch(() => {}))
  })
  // Reload once the updated worker takes over ("Atualizar"); not on the very first install, which had no controller.
  let reloading = !navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) location.reload()
    reloading = true
  })
}

void import('@/main')
