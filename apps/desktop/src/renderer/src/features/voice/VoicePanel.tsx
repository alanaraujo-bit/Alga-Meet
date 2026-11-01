import { MonitorOff, MonitorUp, PhoneOff, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { channelTitle } from '@/store/selectors'
import { Fronds, IconButton } from '@/ui'
import { roomLevelNow } from './levels'
import { t } from './strings'
import { leaveVoice, openCall, useVoice } from './voice'
import s from './chrome.module.css'

/** "Voz conectada" above the user row: where you are, how the link is, and the two actions you need from anywhere. */
export function VoicePanel() {
  const conn = useMedia(useShallow((st) => ({ state: st.connection.state, channelId: st.connection.channelId, reason: st.connection.reason, rtt: st.local?.rttMs ?? null })))
  const sharing = useMedia((st) => st.screen.active)
  const channel = useData((st) => (conn.channelId ? st.channels[conn.channelId] : undefined))
  const spaceName = useData((st) => (channel?.spaceId ? st.spaces[channel.spaceId]?.name : undefined))
  const title = useData((st) => (channel ? channelTitle(st, channel) : ''))
  if (conn.state === 'idle' || (conn.state === 'disconnected' && !conn.reason)) return null

  const warn = conn.state !== 'connected'
  const down = conn.state === 'disconnected'
  const label = conn.state === 'connecting' ? t.state.connecting : conn.state === 'reconnecting' ? t.state.reconnecting : down ? t.state.disconnected : t.state.connected
  const sub = down ? conn.reason : [title, spaceName].filter(Boolean).join(' · ')

  return (
    <div className={s.panel} role="status" aria-live="polite">
      <div className={s.panelTop}>
        <button type="button" className={s.panelState} onClick={() => conn.channelId && openCall(conn.channelId)} aria-label={`${label}. ${t.panel.open}`}>
          <span className={`${s.panelTitle} ${warn ? s.warn : ''}`}>
            <Fronds size={14} breathing={warn && !down} getLevel={warn ? undefined : roomLevelNow} />
            {label}
            {!warn && conn.rtt !== null && <span className={`${s.ping} tnum`}>{t.panel.ping(conn.rtt)}</span>}
          </span>
          <span className={`${s.panelSub} tnum`}>{sub}</span>
        </button>
        {conn.state === 'connected' &&
          (sharing ? (
            <IconButton icon={MonitorOff} label={t.dock.stopShare} onClick={() => void media.stopScreenShare()} />
          ) : (
            <IconButton icon={MonitorUp} label={t.dock.share} onClick={() => useVoice.setState({ picker: true })} />
          ))}
        {down ? <IconButton icon={X} label={t.leave} onClick={leaveVoice} /> : <IconButton icon={PhoneOff} label={t.leave} danger onClick={leaveVoice} />}
      </div>
      {sharing && (
        <div className={s.liveRow}>
          <span className={s.liveDot} aria-hidden />
          <span className={s.liveText}>{t.panel.liveShort}</span>
          <button type="button" className={s.liveStop} onClick={() => void media.stopScreenShare()}>
            {t.dock.stopShare}
          </button>
        </div>
      )}
    </div>
  )
}
