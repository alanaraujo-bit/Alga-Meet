import { DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, Permission } from '@alga/shared'
import { Ban, FileUp, Hash, Phone, PhoneIncoming, Users } from '@/ui/icons'
import { lazy, Suspense, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { formatBytes } from '@/lib/files'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { can, channelTitle, dmPeers, presenceOf, spacePermissions } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Icon, IconButton, PRESENCE_LABEL, VoiceDot } from '@/ui'
import { CallStage } from '../voice/CallStage'
import { VoiceHere } from '../voice/LiveNow'
import { t as tv } from '../voice/strings'
import { joinVoice } from '../voice/voice'
import { Composer } from './Composer'
import { useLightbox } from './lightboxStore'
import { DeleteConfirm } from './MessageItem'
import { MessageList } from './MessageList'
import { TypingIndicator } from './TypingIndicator'
import { addFiles } from './tray'
import { t } from './strings'
import sh from '../shell/shell.module.css'
import s from './chat.module.css'

const Lightbox = lazy(() => import('./Lightbox').then((m) => ({ default: m.Lightbox })))

/** Text conversation for a space channel or a DM. Remounted per channel (key) so per-channel state resets. */
export function ChatView({ channelId, aside }: { channelId: string; aside?: ReactNode }) {
  const channel = useData((st) => st.channels[channelId])
  const title = useData((st) => (channel ? channelTitle(st, channel) : ''))
  const peer = useData((st) => (channel?.type === 'dm' ? (dmPeers(st, channel)[0] ?? null) : null))
  const presence = useData((st) => (peer ? presenceOf(st, peer.id) : null))
  const canSend = useData((st) => !channel?.spaceId || can(spacePermissions(st, channel.spaceId), Permission.SEND_MESSAGES))
  const canAttach = useData((st) => !channel?.spaceId || can(spacePermissions(st, channel.spaceId), Permission.SEND_MESSAGES | Permission.ATTACH_FILES))
  // Drag enter/leave fire per child element: count them so the drop zone does not flicker.
  const [dragging, setDragging] = useState(0)
  const memberList = useUi((st) => st.memberList)
  const callPeople = useData((st) => Object.values(st.voiceStates).filter((v) => v.channelId === channelId).length)
  const inCall = useMedia((st) => st.connection.channelId === channelId && st.connection.state !== 'idle')
  // Read marker as it was when the channel opened: the "Novas" line stays put while you read.
  const [unreadAfter] = useState(() => useData.getState().readStates[channelId]?.lastReadMessageId ?? null)
  const input = useRef<HTMLTextAreaElement>(null)
  // The lightbox chunk loads on the first open and then stays mounted (its exit animation needs it).
  const lightboxOpen = useLightbox((st) => st.at !== null)
  const lightbox = useRef(false)
  lightbox.current ||= lightboxOpen

  useEffect(() => {
    input.current?.focus()
  }, [channelId])

  // Typing anywhere in the conversation goes to the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented: someone took the key (the cinema's shortcuts in a DM call)
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
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
  const target = isDm ? title : `#${title}`
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const drop = {
    onDragEnter: (e: DragEvent) => hasFiles(e) && setDragging((n) => n + 1),
    onDragLeave: (e: DragEvent) => hasFiles(e) && setDragging((n) => Math.max(0, n - 1)),
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = canAttach ? 'copy' : 'none'
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(0)
      if (!canAttach) return
      addFiles(channelId, Array.from(e.dataTransfer.files))
      input.current?.focus()
    },
  }
  return (
    <div className={sh.mainInner}>
      <div className={sh.mainCol} style={{ position: 'relative' }} {...drop}>
        {dragging > 0 && (
          <div className={`${s.dropZone} ${canAttach ? '' : s.dropDenied}`} aria-hidden>
            <span className={s.dropIcon}>
              <Icon icon={canAttach ? FileUp : Ban} size={24} />
            </span>
            <strong>{canAttach ? t.files.dropTitle(target) : t.files.dropDenied}</strong>
            {canAttach && <span>{t.files.dropBody(MAX_ATTACHMENTS, formatBytes(DEFAULT_MAX_ATTACHMENT_BYTES))}</span>}
          </div>
        )}
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
            {channel.spaceId && <VoiceHere spaceId={channel.spaceId} />}
            {isDm && inCall && (
              <span className={s.callChip}>
                <VoiceDot />
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
          <Composer channelId={channelId} spaceId={channel.spaceId} target={target} canSend={canSend} canAttach={canAttach} inputRef={input} />
          <TypingIndicator channelId={channelId} spaceId={channel.spaceId} />
        </div>
      </div>
      {aside}
      <DeleteConfirm />
      {lightbox.current && (
        <Suspense fallback={null}>
          <Lightbox />
        </Suspense>
      )}
    </div>
  )
}
