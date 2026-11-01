import type { StatusPreference } from '@alga/shared'
import { Copy, Headphones, HeadphoneOff, LogOut, Mic, MicOff, PhoneOff, Settings, Signal, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { media, useMedia } from '@/media'
import { setStatus } from '@/store/actions'
import { useData } from '@/store/data'
import { channelTitle, presenceOf } from '@/store/selectors'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Avatar, Divider, Icon, IconButton, MenuButton, Popover, PresenceGlyph, toast } from '@/ui'
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

/** Slot for the active voice connection (full call controls arrive with the call UI wave). */
function VoicePanel() {
  const conn = useMedia((st) => st.connection)
  const channel = useData((st) => (conn.channelId ? st.channels[conn.channelId] : undefined))
  const spaceName = useData((st) => (channel?.spaceId ? st.spaces[channel.spaceId]?.name : undefined))
  const title = useData((st) => (channel ? channelTitle(st, channel) : ''))
  if (conn.state === 'idle' || (conn.state === 'disconnected' && !conn.reason)) return null
  const warn = conn.state !== 'connected'
  const label =
    conn.state === 'connecting' ? t.voice.connecting
    : conn.state === 'reconnecting' ? t.voice.reconnecting
    : conn.state === 'disconnected' ? t.voice.disconnected
    : t.voice.connected
  return (
    <div className={s.voicePanel} role="status" aria-live="polite">
      <div className={s.voiceState}>
        <div className={`${s.voiceStateTitle} ${warn ? s.voiceStateWarn : ''}`}>
          <Icon icon={Signal} size={14} />
          {label}
        </div>
        <div className={s.voiceStateSub}>{conn.state === 'disconnected' ? conn.reason : [title, spaceName].filter(Boolean).join(' / ')}</div>
      </div>
      {conn.state !== 'disconnected' && <IconButton icon={PhoneOff} label={t.voice.leave} danger onClick={() => void media.leave()} />}
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
  const reduced = useUi((st) => st.reducedMotion)
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
          <span className={s.meStatus}>{t.userPanel.status[me.statusPreference]}</span>
        </span>
      </button>
      <IconButton
        icon={muted ? MicOff : Mic}
        label={muted ? t.userPanel.unmute : t.userPanel.mute}
        aria-pressed={muted}
        danger
        disabledReason={micAvailable ? undefined : 'Nenhum microfone encontrado'}
        onClick={() => void media.toggleMute()}
      />
      <IconButton
        icon={deafened ? HeadphoneOff : Headphones}
        label={deafened ? t.userPanel.undeafen : t.userPanel.deafen}
        aria-pressed={deafened}
        danger
        onClick={() => void media.toggleDeafen()}
      />
      <MenuButton
        side="top"
        align="end"
        label={t.userPanel.settings}
        items={() => [
          { label: t.userPanel.settings, icon: Settings, disabled: true, hint: 'Em breve', onSelect: () => undefined },
          { label: t.userPanel.reduceMotion, icon: Sparkles, checked: reduced, onSelect: () => useUi.getState().setPref('reducedMotion', !reduced) },
          { kind: 'separator' },
          { label: t.userPanel.signOut, icon: LogOut, danger: true, onSelect: () => void useSession.getState().logout() },
        ]}
      >
        <IconButton icon={Settings} label={t.userPanel.settings} />
      </MenuButton>

      <Popover anchor={anchor} onClose={() => setAnchor(null)} side="top" align="start" label={t.userPanel.setStatus} width={260}>
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
              <span>
                {t.userPanel.status[p]}
                {t.userPanel.statusHint[p] && <span className={s.statusHint}>{t.userPanel.statusHint[p]}</span>}
              </span>
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
        </div>
      </Popover>
    </div>
  )
}
