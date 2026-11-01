import { MonitorOff, MonitorUp, PhoneOff, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { channelTitle } from '@/store/selectors'
import { Fronds, IconButton, Tooltip } from '@/ui'
import { roomLevelNow } from './levels'
import { t } from './strings'
import { leaveVoice, openCall, useVoice } from './voice'
import s from './chrome.module.css'

/** 0–3 bars: the SFU's own rating when it has one, else the round trip. */
function linkBars(quality: string, rtt: number | null): number {
  if (quality === 'excellent') return 3
  if (quality === 'good') return 2
  if (quality === 'poor') return 1
  if (quality === 'lost') return 0
  return rtt === null || rtt < 150 ? 3 : rtt < 300 ? 2 : 1
}

/**
 * "Voz conectada" above the user row: the ONE place for call status (the stage header only has actions). Where you
 * are, link quality as 3 bars (numbers in the tooltip) and the two actions you need from anywhere.
 */
export function VoicePanel() {
  const conn = useMedia(useShallow((st) => ({ state: st.connection.state, channelId: st.connection.channelId, reason: st.connection.reason, rtt: st.local?.rttMs ?? null, quality: st.self.quality })))
  const loss = useMedia((st) => {
    const l = Object.values(st.participants).flatMap((p) => (p.audio ? [p.audio.packetLossPct] : []))
    return l.length ? Math.max(...l) : null
  })
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
            <span className={s.panelLabel}>{label}</span>
            {!warn && <LinkBars bars={linkBars(conn.quality, conn.rtt)} detail={t.panel.link(conn.rtt, loss)} />}
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
    </div>
  )
}

function LinkBars({ bars, detail }: { bars: number; detail: string }) {
  const label = `${t.panel.quality[bars]}: ${detail}`
  return (
    <Tooltip content={detail}>
      <span className={s.bars} role="img" aria-label={label} data-bars={bars}>
        <i />
        <i />
        <i />
      </span>
    </Tooltip>
  )
}
