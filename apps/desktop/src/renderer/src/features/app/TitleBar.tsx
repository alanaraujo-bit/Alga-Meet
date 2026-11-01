import { Search } from '@/ui/icons'
import { media, useMedia } from '@/media'
import { useSession } from '@/store/session'
import { Icon, Kbd } from '@/ui'
import { useUi } from '@/store/ui'
import { useSettings } from '../settings/store'
import { useSpaceSettings } from '../spaceSettings/store'
import { useVoice } from '../voice/voice'
import { ConnectionChip } from './ConnectionBanner'
import { LogoMark } from './Logo'
import { t } from './strings'
import s from './app.module.css'

/** 40px drag region. The right 140px stays empty for the native caption buttons (titleBarOverlay). */
export function TitleBar({ search }: { search?: boolean }) {
  const profile = window.alga?.config.profile
  const down = useSession((st) => st.gateway === 'reconnecting' || st.gateway === 'connecting')
  // On the call's stage your tile and the filled Tela button already say you're live; the chip is for everywhere else
  // (other channels, Home, settings over the stage), so you never forget.
  const callId = useMedia((st) => st.connection.channelId)
  const onStage = useVoice((st) => st.stage !== null && st.stage === callId)
  const settings = useSettings((st) => st.section !== null)
  const spaceSettings = useSpaceSettings((st) => st.spaceId !== null)
  const sharing = useMedia((st) => st.screen.active)
  const live = sharing && (!onStage || settings || spaceSettings)
  return (
    <header className={s.titlebar}>
      <div className={s.brand}>
        <span className={s.brandMark}>
          <LogoMark size={16} />
        </span>
        {t.appName}
        {profile && profile !== 'default' && <span className={s.profile}>{profile}</span>}
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
