import { useMemo, useRef } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { channelTitle, liveRooms, voiceMembers, type LiveRoom } from '@/store/selectors'
import { Avatar, Button, Tooltip, useSpeakingGlow, VoiceDot } from '@/ui'
import { useLevelGetter } from './levels'
import { t } from './strings'
import { useUi } from '@/store/ui'
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
        {rooms.length > 0 && <VoiceDot />}
        {t.live.title}
      </div>
      {rooms.length === 0 ? <p className={s.liveEmpty}>{t.live.empty}</p> : rooms.map((r) => <LiveRow key={r.channel.id} room={r} />)}
    </section>
  )
}

function LiveRow({ room }: { room: LiveRoom }) {
  const title = useData((st) => channelTitle(st, room.channel))
  const here = useMedia((st) => st.connection.channelId === room.channel.id && st.connection.state !== 'idle')
  const open = useUi((st) => (st.view.kind === 'space' || st.view.kind === 'dm') && st.view.channelId === room.channel.id)
  // Same rule as the channel list: a click looks into the room, a click on the room you are looking at enters it.
  const go = () => (open && !here ? void joinVoice(room.channel.id) : openCall(room.channel.id))
  const where = room.spaceName ?? t.live.call
  const action = here ? t.live.here : open ? t.live.join(title) : t.live.look(title)
  return (
    <Tooltip content={here ? t.panel.open : open ? t.live.join(title) : t.live.look(title)} side="right">
      <button type="button" className={`${s.liveRow2} ${here ? s.liveMine : ''}`} onClick={go} aria-label={`${title}, ${where}. ${action}`}>
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

/**
 * Voice inside the chat: a text channel's header says where this space is talking right now ("3 em Sala de foco",
 * faces) with one click to join. The voice dot stays on the rail and the channel list (≤ 2 per screen). The room you are in wins, then the busiest one.
 */
export function VoiceHere({ spaceId }: { spaceId: string }) {
  const voiceStates = useData((st) => st.voiceStates)
  const myRoom = useMedia((st) => (st.connection.state === 'idle' ? null : st.connection.channelId))
  const room = useMemo(() => {
    const by = new Map<string, number>()
    for (const v of Object.values(voiceStates)) if (v.spaceId === spaceId) by.set(v.channelId, (by.get(v.channelId) ?? 0) + 1)
    if (myRoom && by.has(myRoom)) return myRoom
    return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }, [voiceStates, spaceId, myRoom])
  const channel = useData((st) => (room ? st.channels[room] : undefined))
  const ids = useMemo(() => (room ? voiceMembers({ voiceStates }, room).map((v) => v.userId) : []), [voiceStates, room])
  if (!channel || !ids.length) return null
  const here = myRoom === channel.id
  return (
    <span className={s.here}>
      <AvatarStack ids={ids} channelId={channel.id} />
      <span className={s.hereText}>
        <span className="tnum">{t.here.count(ids.length, channel.name)}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => (here ? openCall(channel.id) : void joinVoice(channel.id))}>
        {here ? t.here.open : t.joinShort}
      </Button>
    </span>
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
