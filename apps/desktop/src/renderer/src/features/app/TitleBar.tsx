import { Search } from 'lucide-react'
import { media, useMedia } from '@/media'
import { useSession } from '@/store/session'
import { Icon, Kbd } from '@/ui'
import { useUi } from '@/store/ui'
import { ConnectionChip } from './ConnectionBanner'
import { LogoMark } from './Logo'
import { t } from './strings'
import s from './app.module.css'

/** 40px drag region. The right 140px stays empty for the native caption buttons (titleBarOverlay). */
export function TitleBar({ search }: { search?: boolean }) {
  const profile = window.alga?.config.profile
  const down = useSession((st) => st.gateway === 'reconnecting' || st.gateway === 'connecting')
  const live = useMedia((st) => st.screen.active)
  return (
    <header className={s.titlebar}>
      <div className={s.brand}>
        <span className={s.brandMark}>
          <LogoMark size={14} />
        </span>
        {t.appName}
        {profile && profile !== 'default' && <span className={s.profile}>{profile}</span>}
        {/* Always visible while you stream, even over settings: you never forget you are live. */}
        {live && (
          <span className={s.liveChip} role="status">
            <span className={s.liveDot} />
            {t.live}
            <button type="button" className={s.liveStop} onClick={() => void media.stopScreenShare()}>
              {t.stopLive}
            </button>
          </span>
        )}
      </div>
      {search && down ? (
        <ConnectionChip />
      ) : search ? (
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
