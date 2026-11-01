import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function Boot() {
  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: '#0c0d10', color: '#e6e8ec', font: '500 14px system-ui' }}>
      Alga Meet {window.alga?.config.version} — {window.alga?.config.profile}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
)
