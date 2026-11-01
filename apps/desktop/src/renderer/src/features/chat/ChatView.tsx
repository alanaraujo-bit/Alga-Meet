import { Permission } from '@alga/shared'
import { Hash, Phone, PhoneIncoming, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { can, channelTitle, dmPeers, presenceOf, spacePermissions } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Fronds, Icon, IconButton, PRESENCE_LABEL } from '@/ui'
import { CallStage } from '../voice/CallStage'
import { t as tv } from '../voice/strings'
import { joinVoice } from '../voice/voice'
import { Composer } from './Composer'
import { DeleteConfirm } from './MessageItem'
import { MessageList } from './MessageList'
import { TypingIndicator } from './TypingIndicator'
import { t } from './strings'
import sh from '../shell/shell.module.css'
import s from './chat.module.css'

/** Text conversation for a space channel or a DM. Remounted per channel (key) so per-channel state resets. */
export function ChatView({ channelId, aside }: { channelId: string; aside?: ReactNode }) {
  const channel = useData((st) => st.channels[channelId])
  const title = useData((st) => (channel ? channelTitle(st, channel) : ''))
  const peer = useData((st) => (channel?.type === 'dm' ? (dmPeers(st, channel)[0] ?? null) : null))
  const presence = useData((st) => (peer ? presenceOf(st, peer.id) : null))
  const canSend = useData((st) => !channel?.spaceId || can(spacePermissions(st, channel.spaceId), Permission.SEND_MESSAGES))
  const memberList = useUi((st) => st.memberList)
  const callPeople = useData((st) => Object.values(st.voiceStates).filter((v) => v.channelId === channelId).length)
  const inCall = useMedia((st) => st.connection.channelId === channelId && st.connection.state !== 'idle')
  // Read marker as it was when the channel opened: the "Novas" line stays put while you read.
  const [unreadAfter] = useState(() => useData.getState().readStates[channelId]?.lastReadMessageId ?? null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [channelId])

  // Typing anywhere in the conversation goes to the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!channel) return null
  const isDm = channel.type === 'dm' || channel.type === 'group_dm'
  return (
    <div className={sh.mainInner}>
      <div className={sh.mainCol}>
        <header className={sh.header}>
          <h1 className={sh.headerTitle}>
            {peer ? <Avatar user={peer} size={24} presence={presence ?? undefined} decorative /> : <Icon icon={Hash} size={18} />}
            {title}
          </h1>
          {(peer && presence) || channel.topic ? (
            <>
              <span className={sh.headerSep} />
              <span className={sh.headerTopic}>{peer && presence ? PRESENCE_LABEL[presence] : channel.topic}</span>
            </>
          ) : null}
          <div className={sh.headerActions}>
            {isDm && inCall && (
              <span className={s.callChip}>
                <Fronds size={12} breathing />
                {tv.call.inCall}
              </span>
            )}
            {isDm && !inCall && (
              <IconButton
                icon={callPeople ? PhoneIncoming : Phone}
                label={callPeople ? tv.call.join : tv.call.start}
                size="lg"
                tooltipSide="bottom"
                className={callPeople ? s.callLive : undefined}
                onClick={() => void joinVoice(channelId)}
              />
            )}
            {channel.spaceId && (
              <IconButton
                icon={Users}
                label={t.header.members}
                aria-pressed={memberList}
                size="lg"
                tooltipSide="bottom"
                onClick={() => useUi.getState().setPref('memberList', !memberList)}
              />
            )}
          </div>
        </header>
        {isDm && (callPeople > 0 || inCall) && <CallStage channel={channel} variant="dm" />}
        <MessageList channelId={channelId} spaceId={channel.spaceId} unreadAfter={unreadAfter} title={title} isDm={isDm} />
        <div className={s.bottom}>
          <Composer channelId={channelId} spaceId={channel.spaceId} target={isDm ? title : `#${title}`} canSend={canSend} inputRef={input} />
          <TypingIndicator channelId={channelId} spaceId={channel.spaceId} />
        </div>
      </div>
      {aside}
      <DeleteConfirm />
    </div>
  )
}
