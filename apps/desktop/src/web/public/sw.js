// Alga Meet PWA service worker. Hashed build files (/assets/*) are kept forever once fetched; the page itself is
// network-first so a deploy shows up on the next open, with the last copy as the offline fallback. The API, the
// gateway and anything cross-origin never go through here.
const VERSION = '__BUILD_ID__'
const SHELL = `alga-shell-${VERSION}`
const ASSETS = 'alga-assets'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('alga-shell-') && key !== SHELL) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/gateway')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) void caches.open(SHELL).then((c) => c.put('/', res.clone()))
          return res
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) void c.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Icons, manifest and the rest of public/: the cached copy now, a fresh one for next time.
  event.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req)
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) void c.put(req, res.clone())
          return res
        })
        .catch(() => hit ?? Response.error())
      return hit ?? fresh
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const tag = event.notification.data?.tag
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = wins[0]
      if (win) {
        await win.focus()
        win.postMessage({ type: 'notification-click', tag })
      } else await self.clients.openWindow(url)
    })(),
  )
})
