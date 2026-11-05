import type { Channel } from '@alga/shared'
import type { Glyph } from '@/ui/icons'
import { ArrowLeftRight, FilmStrip, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings2, Square, Volume2, Waveform } from '@/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { Icon, MenuButton, Spinner, Tooltip, useEnvelope } from '@/ui'
import { end as endCinema, openFromFile, seat } from '../cinema/actions'
import { useCinema } from '../cinema/store'
import { t as cinemaT } from '../cinema/strings'
import { openSettings } from '../settings/store'
import { levelNow } from './levels'
import { t } from './strings'
import { SoundboardPanel } from '../soundboard/SoundboardPanel'
import { SoundEditor } from '../soundboard/SoundEditor'
import { setOpen, useSoundboard } from '../soundboard/store'
import { t as sbT } from '../soundboard/strings'
import { joinVoice, leaveVoice, useVoice } from './voice'
import s from './stage.module.css'

/**
 * One rule, any window size: while the call dock is on screen, the toast stack rises above it (--toast-bottom,
 * measured from the dock itself), so a toast never covers Desconectar.
 */
function useToastClearance(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement.style
    const update = () => root.setProperty('--toast-bottom', `${Math.ceil(window.innerHeight - el.getBoundingClientRect().top + 12)}px`)
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
export function ControlsDock({ channel }: { channel: Channel }) {
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
  const sbButton = useRef<HTMLButtonElement>(null)
  const sbOpen = useSoundboard((st) => st.open)
  const [sbAnchor, setSbAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSbAnchor(sbOpen ? sbButton.current : null), [sbOpen])
  // Cinema (ruling R30: always offered; a server without it answers "Cinema desligado neste servidor").
  const cinema = useCinema(useShallow((st) => ({ open: !!st.session, seated: st.mine.seated, busy: st.busy, host: !!st.session && st.session.hostId === meId })))

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
      {/* One button for both states (the menu only while live): the focus stays on it when the share starts or stops. */}
      <MenuButton
        off={!sharing}
        side="top"
        align="center"
        label={t.dock.stopShare}
        items={() => [
          { label: t.dock.switchSource, icon: ArrowLeftRight, onSelect: () => useVoice.setState({ picker: true }) },
          // Stopping a stream destroys nothing: no red (red is Desconectar's).
          { label: t.dock.stopShare, icon: Square, onSelect: () => void media.stopScreenShare() },
        ]}
      >
        {sharing ? (
          <CallButton icon={MonitorUp} label={t.dock.stopShare} pressed on />
        ) : (
          <CallButton icon={MonitorUp} label={t.dock.share} disabled={!connected} onClick={() => useVoice.setState({ picker: true })} />
        )}
      </MenuButton>
      <CallButton
        icon={FilmStrip}
        label={cinema.host ? cinemaT.stage.end : cinema.seated ? cinemaT.standUp : cinema.open ? cinemaT.sitHere : cinemaT.button}
        hint={cinema.open ? undefined : cinemaT.buttonHint}
        on={cinema.seated}
        aria-pressed={cinema.seated}
        disabled={!connected || cinema.busy}
        onClick={() => (cinema.host ? endCinema() : cinema.open ? seat(!cinema.seated) : void openFromFile())}
      />
      {channel.spaceId && (
        <CallButton
          ref={sbButton}
          icon={Waveform}
          label={sbT.button}
          hint={sbT.buttonHint}
          on={sbOpen}
          aria-expanded={sbOpen}
          aria-haspopup="dialog"
          disabled={!connected}
          onClick={() => setOpen(!sbOpen)}
        />
      )}
      <CallButton icon={Settings2} label={t.dock.settings} onClick={() => openSettings('voice')} />
      <span className={s.dockSep} />
      <CallButton icon={PhoneOff} label={t.dock.leave} leave onClick={leaveVoice} />
      {channel.spaceId && <SoundboardPanel anchor={sbAnchor} onClose={() => setOpen(false)} channel={channel} />}
      {channel.spaceId && <SoundEditor />}
    </div>
  )
}

/** My mic level while the test runs (not in a call yet, so levelNow() reads 0); nothing while muted. */
const testLevel = () => {
  const m = useMedia.getState()
  return m.micTest.active && !m.self.muted ? m.self.level : 0
}

/**
 * Before entering: the same dock in the same place, so nothing jumps when you join. Mic and sound are chosen before
 * anyone hears you; the mic test runs only when asked (opening the mic just to look at a room would light the
 * system's mic indicator). The join pill sits where Desconectar will be.
 */
export function LobbyDock({ channel, joining, full }: { channel: Channel; joining: boolean; full: boolean }) {
  const self = useMedia(useShallow((st) => ({ muted: st.self.muted, deafened: st.self.deafened, mic: st.self.micAvailable })))
  const testing = useMedia((st) => st.micTest.active)
  const meter = useRef<HTMLSpanElement>(null)
  useEnvelope(meter, testLevel)
  const dock = useRef<HTMLDivElement>(null)
  useToastClearance(dock)
  const join = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const started = useRef(false)
  useEffect(() => {
    alive.current = true
    // Leaving by keyboard (Desconectar) removes the focused call dock: the keyboard lands on Entrar, not on <body>.
    if (document.activeElement === document.body) join.current?.focus()
    // The test belongs to this screen: leaving it, or joining (the call takes the mic), ends it.
    return () => {
      alive.current = false
      if (started.current || useMedia.getState().micTest.active) void media.stopMicTest()
    }
  }, [])
  // A test that finishes opening the mic after this screen is gone (Testar, then Entrar right away) is closed at once.
  const startTest = async () => {
    started.current = true
    await media.startMicTest({ loopback: false })
    if (!alive.current) void media.stopMicTest()
  }
  return (
    <div ref={dock} className={s.dock} role="toolbar" aria-label={t.lobby.toolbar}>
      <CallButton
        icon={self.muted || !self.mic ? MicOff : Mic}
        label={!self.mic ? t.dock.noMic : self.muted ? t.dock.unmute : t.dock.mute}
        pressed={self.muted}
        off={self.muted || !self.mic}
        disabled={!self.mic}
        onClick={() => void media.toggleMute()}
      >
        <span ref={meter} className={s.ctlMeter} aria-hidden />
      </CallButton>
      <CallButton
        icon={self.deafened ? HeadphoneOff : Headphones}
        label={self.deafened ? t.dock.undeafen : t.dock.deafen}
        pressed={self.deafened}
        off={self.deafened}
        onClick={() => void media.toggleDeafen()}
      />
      <CallButton
        icon={Waveform}
        label={testing ? t.lobby.stopTest : t.lobby.test}
        hint={testing ? t.lobby.testHint : undefined}
        pressed={testing}
        on={testing}
        disabled={!self.mic}
        onClick={() => void (testing ? media.stopMicTest() : startTest())}
      />
      <CallButton icon={Settings2} label={t.dock.settings} onClick={() => openSettings('voice')} />
      <span className={s.dockSep} />
      <button
        ref={join}
        type="button"
        className={s.joinPill}
        aria-disabled={full || undefined}
        aria-label={full ? t.lobby.full : channel.spaceId ? t.join(channel.name ?? '') : t.call.join}
        onClick={full || joining ? undefined : () => void joinVoice(channel.id)}
      >
        {joining ? <Spinner size={12} /> : <Icon icon={Volume2} size={16} />}
        <span>{full ? t.lobby.full : joining ? t.joining : t.joinShort}</span>
      </button>
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
  icon: Glyph
  label: string
  hint?: string
  pressed?: boolean
  off?: boolean
  on?: boolean
  leave?: boolean
  disabled?: boolean
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
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
