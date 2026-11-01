import type { StatusPreference } from '@alga/shared'
import { Check, Copy, Headphones, HeadphoneOff, LogOut, Mic, MicOff, Settings } from 'lucide-react'
import { useRef, useState } from 'react'
import { media, useMedia } from '@/media'
import { setStatus } from '@/store/actions'
import { useData } from '@/store/data'
import { presenceOf } from '@/store/selectors'
import { useSession } from '@/store/session'
import { Avatar, Divider, Icon, IconButton, Popover, PresenceGlyph, toast } from '@/ui'
import { openSettings } from '../settings/store'
import { VoicePanel } from '../voice/VoicePanel'
import { errorText } from '@/lib/errors'
import { copyText } from '@/lib/clipboard'
import { t } from '../app/strings'
import s from './shell.module.css'

export function UserPanel() {
  return (
    <div className={s.dock}>
      <VoicePanel />
      <UserRow />
    </div>
  )
}

const STATUSES: StatusPreference[] = ['online', 'idle', 'dnd', 'invisible']

function UserRow() {
  const me = useData((st) => st.me)
  const presence = useData((st) => (st.me ? presenceOf(st, st.me.id) : 'offline'))
  const muted = useMedia((st) => st.self.muted)
  const deafened = useMedia((st) => st.self.deafened)
  const micAvailable = useMedia((st) => st.self.micAvailable)
  const serverMute = useData((st) => !!(st.me && st.voiceStates[st.me.id]?.serverMute))
  // While the realtime link is down, your own status would be a lie: say what is actually happening.
  const offline = useSession((st) => st.gateway === 'reconnecting' || st.gateway === 'connecting')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  if (!me) return null

  const pick = (p: StatusPreference) => {
    setAnchor(null)
    btn.current?.focus()
    setStatus(p).catch((e: unknown) => toast.error(errorText(e, t.userPanel.statusError)))
  }

  return (
    <div className={s.userRow}>
      <button
        ref={btn}
        type="button"
        className={s.me}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <Avatar user={me} size={32} presence={presence} decorative />
        <span className={s.meText}>
          <span className={s.meName}>{me.displayName}</span>
          {offline ? (
            <span className={`${s.meStatus} ${s.meStatusWarn}`}>{t.userPanel.reconnecting}</span>
          ) : (
            <span className={s.meStatus}>{t.userPanel.status[me.statusPreference]}</span>
          )}
        </span>
      </button>
      <IconButton
        icon={muted ? MicOff : Mic}
        label={muted ? t.userPanel.unmute : t.userPanel.mute}
        aria-pressed={muted}
        danger
        disabledReason={serverMute ? t.userPanel.serverMuted : micAvailable ? undefined : 'Nenhum microfone encontrado'}
        onClick={() => void media.toggleMute()}
      />
      <IconButton
        icon={deafened ? HeadphoneOff : Headphones}
        label={deafened ? t.userPanel.undeafen : t.userPanel.deafen}
        aria-pressed={deafened}
        danger
        onClick={() => void media.toggleDeafen()}
      />
      <IconButton icon={Settings} label={t.userPanel.settings} shortcut="Ctrl ," onClick={() => openSettings()} />

      <Popover anchor={anchor} onClose={() => setAnchor(null)} side="top" align="start" gap={12} label={t.userPanel.setStatus} width={232}>
        <div className={s.profileCard}>
          <Avatar user={me} size={40} presence={presence} decorative />
          <div style={{ minWidth: 0 }}>
            <div className={s.profileName}>{me.displayName}</div>
            <div className={s.profileUser}>@{me.username}</div>
          </div>
        </div>
        <div className={s.statusMenu} role="radiogroup" aria-label={t.userPanel.setStatus}>
          {STATUSES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={me.statusPreference === p} className={s.statusItem} onClick={() => pick(p)}>
              <span className={s.statusDot}>
                <PresenceGlyph status={p === 'invisible' ? 'offline' : p} />
              </span>
              <span className={s.statusLabel}>
                {t.userPanel.status[p]}
                {t.userPanel.statusHint[p] && <span className={s.statusHint}>{t.userPanel.statusHint[p]}</span>}
              </span>
              {me.statusPreference === p && (
                <span className={s.statusCheck}>
                  <Icon icon={Check} size={14} />
                </span>
              )}
            </button>
          ))}
          <Divider style={{ margin: '6px 0' }} />
          <button
            type="button"
            className={s.statusItem}
            onClick={() => {
              void copyText(me.username)
              toast.success(t.userPanel.copied)
              setAnchor(null)
            }}
          >
            <span className={s.statusDot} style={{ marginTop: 2 }}>
              <Icon icon={Copy} size={14} />
            </span>
            {t.userPanel.copyUsername}
          </button>
          <button
            type="button"
            className={`${s.statusItem} ${s.statusDanger}`}
            onClick={() => {
              setAnchor(null)
              void useSession.getState().logout()
            }}
          >
            <span className={s.statusDot} style={{ marginTop: 2 }}>
              <Icon icon={LogOut} size={14} />
            </span>
            {t.userPanel.signOut}
          </button>
        </div>
      </Popover>
    </div>
  )
}
