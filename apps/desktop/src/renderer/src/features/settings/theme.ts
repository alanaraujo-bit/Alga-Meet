import { create } from 'zustand'

/** Aparência › Tema. The PWA follows the device by default; the desktop app stays dark (its theme is not offered yet). */
export type ThemePref = 'system' | 'dark' | 'light'

const KEY = 'alga.theme'
export const themeOffered = window.alga?.config?.shell === 'web'

function load(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const useTheme = create<{ pref: ThemePref }>()(() => ({ pref: themeOffered ? load() : 'dark' }))

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: for this page only */
  }
  useTheme.setState({ pref })
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
// The browser's own chrome (status bar, task switcher) takes the app's chrome color.
const CHROME = { dark: '#0b0b0c', light: '#f3f3f5' } as const

function apply() {
  const { pref } = useTheme.getState()
  const theme = pref === 'system' ? (mq?.matches === false ? 'light' : 'dark') : pref
  const html = document.documentElement
  if (theme === 'light') html.dataset.theme = 'light'
  else delete html.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  document.body.style.background = CHROME[theme]
}

if (themeOffered) {
  useTheme.subscribe(apply)
  mq?.addEventListener('change', apply)
  apply()
}
