import { useData } from '@/store/data'
import { Button, IconButton, toast } from '@/ui'
import { EyeOff, PauseCircle, Shield } from '@/ui/icons'
import { openSettings } from '../settings/store'
import { ActivityCard } from './Activity'
import { pauseSharing, useMyActivity } from './store'
import { t } from './strings'
import s from './activity.module.css'

const HOUR = 3600_000
const clock = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Your own activity in your profile popover, with the controls right where it shows: pause, hide this app, settings. */
export function OwnActivity({ onNavigate }: { onNavigate?: () => void }) {
  const me = useData((st) => st.me?.id)
  const detected = useMyActivity((st) => st.detected)
  const pausedUntil = useMyActivity((st) => st.pausedUntil)
  if (!me || !detected) return null

  if (pausedUntil) {
    return (
      <div className={s.paused}>
        <span>{t.own.paused(clock(pausedUntil))}</span>
        <Button size="sm" variant="ghost" onClick={() => pauseSharing(null)}>
          {t.own.resume}
        </Button>
      </div>
    )
  }

  const hide = () => {
    const name = detected.name
    void window.alga.activity.setAppShown(detected.key, false).then(
      () => toast.success(t.own.hidden(name)),
      () => undefined,
    )
  }
  return (
    <ActivityCard userId={me}>
      <div className={s.actions}>
        <Button size="sm" variant="ghost" icon={PauseCircle} onClick={() => pauseSharing(HOUR)}>
          {t.own.pause}
        </Button>
        <Button size="sm" variant="ghost" icon={EyeOff} aria-label={t.own.hide(detected.name)} title={t.own.hide(detected.name)} onClick={hide}>
          {t.own.hideShort}
        </Button>
        <span className={s.actionEnd}>
          <IconButton
            icon={Shield}
            label={t.own.settings}
            onClick={() => {
              onNavigate?.()
              openSettings('activity')
            }}
          />
        </span>
      </div>
    </ActivityCard>
  )
}
