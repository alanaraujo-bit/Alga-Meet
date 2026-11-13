import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// Dev-only media bench (unpackaged builds): index.html?url=…&token=…#media-lab
const MediaLab = lazy(() => import('./media/MediaLab').then((m) => ({ default: m.MediaLab })))
const mediaLab = location.hash === '#media-lab' && !window.alga?.config?.isPackaged
// Dev-only cosmetics showcase and perf bench (unpackaged builds): index.html#cosmetics-gallery[/sheet|/bench|/bench-off]
const Gallery = lazy(() => import('./features/billing/Gallery').then((m) => ({ default: m.CosmeticsGallery })))
const gallery = location.hash.startsWith('#cosmetics-gallery') && !window.alga?.config?.isPackaged
// Dev-only bench of the 3D rooms (unpackaged builds): index.html#worlds-lab, see vite.worlds-lab.config.ts
const WorldsLab = lazy(() => import('./features/worlds/Lab').then((m) => ({ default: m.WorldsLab })))
const worldsLab = location.hash.startsWith('#worlds-lab') && !window.alga?.config?.isPackaged
// The app (and its global styles) is its own chunk so the media lab keeps a clean page.
const App = lazy(() => import('./features/app/App').then((m) => ({ default: m.App })))

createRoot(document.getElementById('root')!).render(
  mediaLab ? (
    <Suspense>
      <MediaLab />
    </Suspense>
  ) : gallery ? (
    <Suspense>
      <Gallery />
    </Suspense>
  ) : worldsLab ? (
    <Suspense>
      <WorldsLab />
    </Suspense>
  ) : (
    <StrictMode>
      <Suspense fallback={<div style={{ height: '100vh', background: '#0b0b0c' }} />}>
        <App />
      </Suspense>
    </StrictMode>
  ),
)
