// The room's live chat over the film: lines rise in the lower-left corner, clear of the subtitles and the controls,
// and leave after a few seconds (chat.ts). Enter opens the field; Esc or an empty blur closes it.
import { CINEMA_CHAT_MAX, type Channel } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, usePersonHue } from '@/ui'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { useCinema } from '../store'
import { t } from '../strings'
import { closeChat, nextExpiry, sendChat, useChat, visibleMessages, type ChatMessage } from './chat'
import { reducedMotion } from './prefs'
import s from './room.module.css'

export function ChatLayer({ channel, uiShown }: { channel: Channel; uiShown: boolean }) {
  const messages = useChat((st) => st.messages)
  const open = useChat((st) => st.open)
  const on = useCinema((st) => st.prefs.chat)
  // Read at every render (the room re-renders often); one exact timer wakes it when the next line runs out.
  const now = Date.now()
  const next = nextExpiry(messages, now, open)
  const [, wake] = useState(0)
  useEffect(() => {
    if (next === null) return
    const id = setTimeout(() => wake((n) => n + 1), Math.max(0, next - Date.now()) + 16)
    return () => clearTimeout(id)
  }, [next])
  if (!on && !open) return null
  const shown = visibleMessages(messages, now, open)
  return (
    <div className={s.chat} data-raised={uiShown || open} data-open={open}>
      <ol className={s.chatLog} role="log" aria-label={t.room.chatLog} aria-live="polite">
        <AnimatePresence initial={false}>
          {shown.map((m) => <Line key={m.id} m={m} channel={channel} />)}
        </AnimatePresence>
      </ol>
      {open && <Field />}
    </div>
  )
}

function Line({ m, channel }: { m: ChatMessage; channel: Channel }) {
  const user = useData((st) => st.users[m.userId])
  const name = useData((st) => displayName(st, m.userId, channel.spaceId))
  const hue = usePersonHue(user)
  const still = reducedMotion()
  return (
    <motion.li
      layout={!still}
      className={s.chatLine}
      style={{ '--h': hue } as CSSProperties}
      initial={still ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, transition: { duration: 0.32, ease: EASE_IN } }}
    >
      <Avatar user={user ?? { id: m.userId, displayName: name, avatarUrl: null }} size={20} decorative />
      <span className={s.chatText}>
        <b className={s.chatName}>{name}</b> {m.text}
      </span>
    </motion.li>
  )
}

function Field() {
  const [text, setText] = useState('')
  const [slow, setSlow] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return closeChat()
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const r = sendChat(text)
    if (r === 'empty') return closeChat()
    setSlow(r === 'slow')
    if (r === 'sent') setText('')
  }
  return (
    <div className={s.chatField}>
      <input
        ref={ref}
        className={s.chatInput}
        aria-label={t.room.chatField}
        placeholder={t.room.chatPlaceholder}
        maxLength={CINEMA_CHAT_MAX}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSlow(false)
        }}
        onKeyDown={onKey}
        onBlur={() => !text.trim() && closeChat()}
      />
      <span className={s.chatKeys} aria-live="polite">{slow ? t.room.chatSlow : t.room.chatKeys}</span>
    </div>
  )
}
