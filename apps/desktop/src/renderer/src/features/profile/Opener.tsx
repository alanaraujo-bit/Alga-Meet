import { Icon } from '@/ui'
import { Maximize2 } from '@/ui/icons'
import { openProfile } from './ProfileModal'
import s from './profile.module.css'

/** A child of ProfileCard in popovers: the banner becomes the way into the full profile. */
export function ProfileOpener({ userId, spaceId, onOpen }: { userId: string; spaceId: string | null; onOpen?: () => void }) {
  return (
    <button
      type="button"
      className={s.opener}
      aria-label="Ver perfil completo"
      onClick={() => {
        onOpen?.()
        openProfile(userId, spaceId)
      }}
    >
      <span className={s.openerHint} aria-hidden>
        <Icon icon={Maximize2} size={12} />
        Ver perfil
      </span>
    </button>
  )
}
