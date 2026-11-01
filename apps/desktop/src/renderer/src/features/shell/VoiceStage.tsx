import type { Channel } from '@alga/shared'
import { HeadphoneOff, MicOff, PhoneOff, Volume2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { media, useMedia } from '@/media'
import { errorText } from '@/lib/errors'
import { voiceJoin } from '@/store/actions'
import { useData } from '@/store/data'
import { voiceMembers } from '@/store/selectors'
import { Avatar, Button, EmptyState, Icon, toast, useSpeakingGlow } from '@/ui'
import { t } from './strings'
import s from './voice.module.css'
import sh from './shell.module.css'

/**
 * Call stage slot. Wave 1: who is in the channel + join/leave wired to the media engine.
 * The full stage (tiles, screen share, controls) replaces the body in the call-UI wave.
 */
export function VoiceStage({ channel }: { channel: Channel }) {
  const voiceStates = useData((st) => st.voiceStates)
  const people = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  const conn = useMedia((st) => st.connection)
  const here = conn.channelId === channel.id && conn.state !== 'idle' && conn.state !== 'disconnected'
  const [busy, setBusy] = useState(false)

  const join = async () => {
    setBusy(true)
    try {
      const r = await voiceJoin(channel.id)
      await media.join({
        url: r.url,
        token: r.token,
        bitrateKbps: r.bitrateKbps,
        channelId: channel.id,
        refresh: async () => {
          const n = await voiceJoin(channel.id)
          return { url: n.url, token: n.token }
        },
      })
    } catch (e) {
      toast.error(errorText(e, t.voiceStage.joinError))
    } finally {
      setBusy(false)
    }
  }

  const action = here ? (
    <Button variant="danger" size="lg" icon={PhoneOff} onClick={() => void media.leave()}>
      {t.voiceStage.leave}
    </Button>
  ) : (
    <Button variant="primary" size="lg" icon={Volume2} loading={busy || (conn.channelId === channel.id && conn.state === 'connecting')} onClick={() => void join()}>
      {t.voiceStage.join}
    </Button>
  )

  return (
    <div className={sh.mainCol}>
      <header className={sh.header}>
        <h1 className={sh.headerTitle}>
          <Icon icon={Volume2} size={18} />
          {channel.name}
        </h1>
        {channel.topic && (
          <>
            <span className={sh.headerSep} />
            <span className={sh.headerTopic}>{channel.topic}</span>
          </>
        )}
      </header>
      <div className={s.stage}>
        {people.length === 0 ? (
          <EmptyState icon={Volume2} title={t.voiceStage.empty} actions={action}>
            {t.voiceStage.emptyBody}
          </EmptyState>
        ) : (
          <>
            <p className={s.count}>{t.voiceStage.inCall(people.length)}</p>
            <ul className={s.grid}>
              {people.map((v) => (
                <StageTile key={v.userId} userId={v.userId} muted={v.selfMute || v.serverMute} deaf={v.selfDeaf || v.serverDeaf} />
              ))}
            </ul>
            <div className={s.controls}>{action}</div>
          </>
        )}
      </div>
    </div>
  )
}

function StageTile({ userId, muted, deaf }: { userId: string; muted: boolean; deaf: boolean }) {
  const user = useData((st) => st.users[userId])
  const meId = useData((st) => st.me?.id)
  const glow = useRef<HTMLSpanElement>(null)
  // Voice envelope drives the glow straight from the media store (no React re-render per frame).
  const getLevel = useCallback(() => {
    const m = useMedia.getState()
    return userId === meId ? (m.self.speaking ? m.self.level : 0) : (m.participants[userId]?.level ?? 0)
  }, [userId, meId])
  useSpeakingGlow(glow, getLevel)
  if (!user) return null
  return (
    <li className={s.tile}>
      <Avatar user={user} size={80} glowRef={glow} decorative />
      <span className={s.name}>
        {user.displayName}
        {deaf ? <Icon icon={HeadphoneOff} size={14} label="Áudio desativado" /> : muted ? <Icon icon={MicOff} size={14} label="Microfone desativado" /> : null}
      </span>
    </li>
  )
}
