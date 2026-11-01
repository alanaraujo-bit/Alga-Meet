import { useMemo, useRef } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { channelTitle, liveRooms, type LiveRoom } from '@/store/selectors'
import { Avatar, Fronds, Tooltip, useSpeakingGlow } from '@/ui'
import { useLevelGetter } from './levels'
import { t } from './strings'
import { joinVoice, openCall } from './voice'
import s from './chrome.module.css'

/** "Agora": where your people are hanging out right now, across every space and DM call. One click joins. */
export function LiveNow() {
  const voiceStates = useData((st) => st.voiceStates)
  const channels = useData((st) => st.channels)
  const spaces = useData((st) => st.spaces)
  const relationships = useData((st) => st.relationships)
  const me = useData((st) => st.me)
  const rooms = useMemo(() => liveRooms({ voiceStates, channels, spaces, relationships, me }), [voiceStates, channels, spaces, relationships, me])
  return (
    <section className={s.live} aria-label={t.live.title}>
      <div className={s.liveHead}>
        <Fronds size={12} breathing={rooms.length > 0} />
        {t.live.title}
      </div>
      {rooms.length === 0 ? <p className={s.liveEmpty}>{t.live.empty}</p> : rooms.map((r) => <LiveRow key={r.channel.id} room={r} />)}
    </section>
  )
}

function LiveRow({ room }: { room: LiveRoom }) {
  const title = useData((st) => channelTitle(st, room.channel))
  const here = useMedia((st) => st.connection.channelId === room.channel.id && st.connection.state !== 'idle')
  const go = () => {
    openCall(room.channel.id)
    if (!here) void joinVoice(room.channel.id)
  }
  const where = room.spaceName ?? t.live.call
  return (
    <Tooltip content={here ? t.panel.open : t.live.join(title)} side="right">
      <button type="button" className={`${s.liveRow2} ${here ? s.liveMine : ''}`} onClick={go} aria-label={`${title}, ${where}. ${here ? t.live.here : t.live.join(title)}`}>
        <AvatarStack ids={room.people.map((p) => p.userId)} channelId={room.channel.id} />
        <span className={s.liveText2}>
          <span className={s.liveName}>{title}</span>
          <span className={s.liveWhere}>{here ? `${where} · ${t.live.here}` : where}</span>
        </span>
        {room.streaming && <span className={s.liveTag}>{t.live.streaming}</span>}
      </button>
    </Tooltip>
  )
}

const STACK = 3

function AvatarStack({ ids, channelId }: { ids: string[]; channelId: string }) {
  const shown = ids.slice(0, STACK)
  return (
    <span className={s.stack} aria-hidden>
      {shown.map((id) => (
        <StackAvatar key={id} userId={id} channelId={channelId} />
      ))}
      {ids.length > STACK && <span className={s.stackMore}>{t.live.more(ids.length - STACK)}</span>}
    </span>
  )
}

function StackAvatar({ userId, channelId }: { userId: string; channelId: string }) {
  const user = useData((st) => st.users[userId])
  const glow = useRef<HTMLSpanElement>(null)
  useSpeakingGlow(glow, useLevelGetter(userId, channelId))
  if (!user) return null
  return (
    <span className={s.stackItem}>
      <Avatar user={user} size={20} glowRef={glow} decorative />
    </span>
  )
}
