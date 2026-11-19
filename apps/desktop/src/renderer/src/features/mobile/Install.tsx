import { useEffect, useState } from 'react'
import { Icon } from '@/ui'
import { Download } from '@/ui/icons'
import { t } from './strings'
import m from './mobile.module.css'

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const w = window as Window & { algaInstall?: InstallPrompt }
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const iosSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)

/** "Instalar o Alga" on Você: the browser's own install (Chrome, Edge, Android), or the two taps of iOS Safari. */
export function InstallCard() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(() => w.algaInstall ?? null)
  const [installed, setInstalled] = useState(standalone)
  useEffect(() => {
    const ready = () => setPrompt(w.algaInstall ?? null)
    const done = () => setInstalled(true)
    window.addEventListener('alga-installable', ready)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('alga-installable', ready)
      window.removeEventListener('appinstalled', done)
    }
  }, [])
  if (installed || (!prompt && !iosSafari)) return null
  return (
    <div className={m.pushCard}>
      <span className={m.rowGlyph}>
        <Icon icon={Download} size={20} />
      </span>
      <span className={m.rowText}>
        <span className={m.rowName}>{t.install.title}</span>
        <span className={m.rowSub}>{prompt ? t.install.body : t.install.ios}</span>
      </span>
      {prompt && (
        <button
          type="button"
          className={m.installBtn}
          onClick={async () => {
            await prompt.prompt()
            if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true)
            w.algaInstall = undefined
            setPrompt(null)
          }}
        >
          {t.install.cta}
        </button>
      )}
    </div>
  )
}
