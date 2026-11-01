import type { Channel } from '@alga/shared'
import type { LucideIcon } from 'lucide-react'
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings2 } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { Icon, MenuButton, Tooltip, useEnvelope } from '@/ui'
import { openSettings } from '../settings/store'
import { levelNow } from './levels'
import { t } from './strings'
import { leaveVoice, useVoice } from './voice'
import s from './stage.module.css'

/** Toast stack's right edge (ui/overlay.module.css: right 16 px, up to 380 px wide). */
const TOAST_ZONE = 16 + 380

/**
 * Toasts live bottom-right. When this dock sits on the window's bottom edge under that corner (narrow windows),
 * the stack rises above it (--toast-bottom), so a toast never covers Desconectar.
 */
function useToastClearance(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement.style
    const update = () => {
      const r = el.getBoundingClientRect()
      const under = window.innerHeight - r.bottom < 48 && r.right > window.innerWidth - TOAST_ZONE
      if (under) root.setProperty('--toast-bottom', `${Math.ceil(window.innerHeight - r.top + 12)}px`)
      else root.removeProperty('--toast-bottom')
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      root.removeProperty('--toast-bottom')
    }
  }, [ref])
}

/** Floating call controls: mic, deafen | share | settings | disconnect. 40px targets, state by icon + color + tint. */
export function ControlsDock({ channel: _channel }: { channel: Channel }) {
  const self = useMedia(useShallow((st) => ({ muted: st.self.muted, deafened: st.self.deafened, mic: st.self.micAvailable, ptt: st.self.inputMode === 'ptt' })))
  const sharing = useMedia((st) => st.screen.active)
  const connected = useMedia((st) => st.connection.state === 'connected')
  const meId = useData((st) => st.me?.id ?? '')
  // Moderation is enforced by the SFU: the toggle would do nothing, so it says why instead.
  const server = useData(useShallow((st) => ({ mute: !!st.voiceStates[meId]?.serverMute, deaf: !!st.voiceStates[meId]?.serverDeaf })))
  const meter = useRef<HTMLSpanElement>(null)
  const level = useCallback(() => levelNow(meId), [meId])
  useEnvelope(meter, level)
  const dock = useRef<HTMLDivElement>(null)
  useToastClearance(dock)

  return (
    <div ref={dock} className={s.dock} role="toolbar" aria-label="Controles da chamada">
      <CallButton
        icon={self.muted || !self.mic || server.mute ? MicOff : Mic}
        label={server.mute ? t.dock.serverMuted : !self.mic ? t.dock.noMic : self.muted ? t.dock.unmute : t.dock.mute}
        hint={self.ptt && !self.muted ? t.dock.pttHint : undefined}
        pressed={self.muted}
        off={self.muted || !self.mic || server.mute}
        disabled={!self.mic || server.mute}
        onClick={() => void media.toggleMute()}
      >
        <span ref={meter} className={s.ctlMeter} aria-hidden />
      </CallButton>
      <CallButton
        icon={self.deafened || server.deaf ? HeadphoneOff : Headphones}
        label={server.deaf ? t.dock.serverDeafened : self.deafened ? t.dock.undeafen : t.dock.deafen}
        pressed={self.deafened}
        off={self.deafened || server.deaf}
        disabled={server.deaf}
        onClick={() => void media.toggleDeafen()}
      />
      <span className={s.dockSep} />
      {sharing ? (
        <MenuButton
          side="top"
          align="center"
          label={t.dock.stopShare}
          items={() => [
            { label: t.dock.switchSource, icon: MonitorUp, onSelect: () => useVoice.setState({ picker: true }) },
            { label: t.dock.stopShare, icon: MonitorOff, danger: true, onSelect: () => void media.stopScreenShare() },
          ]}
        >
          <CallButton icon={MonitorUp} label={t.dock.stopShare} pressed on />
        </MenuButton>
      ) : (
        <CallButton icon={MonitorUp} label={t.dock.share} disabled={!connected} onClick={() => useVoice.setState({ picker: true })} />
      )}
      <CallButton icon={Settings2} label={t.dock.settings} onClick={() => openSettings('voice')} />
      <span className={s.dockSep} />
      <CallButton icon={PhoneOff} label={t.dock.leave} leave onClick={leaveVoice} />
    </div>
  )
}

function CallButton({
  icon,
  label,
  hint,
  pressed,
  off,
  on,
  leave,
  disabled,
  onClick,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon
  label: string
  hint?: string
  pressed?: boolean
  off?: boolean
  on?: boolean
  leave?: boolean
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <Tooltip content={hint ? `${label}. ${hint}` : label} side="top">
      <button
        {...rest}
        type="button"
        className={`${s.ctl} ${off ? s.ctlOff : ''} ${on ? s.ctlOn : ''} ${leave ? s.ctlLeave : ''}`}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
      >
        <Icon icon={icon} size={18} />
        {children}
      </button>
    </Tooltip>
  )
}
