import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url'
import { Setup } from './Setup'
import './setup.css'

// Latin only (inlined): the page is embedded in the setup exe, so every byte ships in the installer.
const face = new FontFace('Inter Variable', `url(${inter}) format('woff2')`, { weight: '100 900' })
document.fonts.add(face)

void face
  .load()
  .catch(() => undefined)
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <Setup />
      </StrictMode>,
    ),
  )
