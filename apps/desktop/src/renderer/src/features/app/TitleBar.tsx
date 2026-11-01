import { Search } from 'lucide-react'
import { Icon, Kbd } from '@/ui'
import { useUi } from '@/store/ui'
import { LogoMark } from './Logo'
import { t } from './strings'
import s from './app.module.css'

/** 40px drag region. The right 140px stays empty for the native caption buttons (titleBarOverlay). */
export function TitleBar({ search }: { search?: boolean }) {
  const profile = window.alga?.config.profile
  return (
    <header className={s.titlebar}>
      <div className={s.brand}>
        <LogoMark size={14} />
        {t.appName}
        {profile && profile !== 'default' && <span className={s.profile}>{profile}</span>}
      </div>
      {search ? (
        <button type="button" className={s.search} onClick={() => useUi.getState().setSwitcher(true)} aria-keyshortcuts="Control+K">
          <Icon icon={Search} size={14} />
          <span className={s.searchLabel}>{t.search}</span>
          <Kbd>{t.searchShortcut}</Kbd>
        </button>
      ) : (
        <span />
      )}
      <span />
    </header>
  )
}
