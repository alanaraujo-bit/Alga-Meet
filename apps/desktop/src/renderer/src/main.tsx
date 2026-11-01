import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// Dev-only media bench (unpackaged builds): index.html?url=…&token=…#media-lab
const MediaLab = lazy(() => import('./media/MediaLab').then((m) => ({ default: m.MediaLab })))
const mediaLab = location.hash === '#media-lab' && !window.alga?.config?.isPackaged
// The app (and its global styles) is its own chunk so the media lab keeps a clean page.
const App = lazy(() => import('./features/app/App').then((m) => ({ default: m.App })))

createRoot(document.getElementById('root')!).render(
  mediaLab ? (
    <Suspense>
      <MediaLab />
    </Suspense>
  ) : (
    <StrictMode>
      <Suspense fallback={<div style={{ height: '100vh', background: '#080b0c' }} />}>
        <App />
      </Suspense>
    </StrictMode>
  ),
)
