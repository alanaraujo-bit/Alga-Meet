import { SendHorizontal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { toPlainText } from '@/lib/markdown'
import { sendMessage, typing } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { IconButton } from '@/ui'
import { t } from './strings'
import s from './chat.module.css'

export const MAX_LEN = 4000
const TYPING_EVERY_MS = 8000
/** Drafts survive channel switches (in-memory for the session). */
const drafts = new Map<string, string>()

export function Composer({
  channelId,
  spaceId,
  target,
  canSend,
  inputRef,
}: {
  channelId: string
  spaceId: string | null
  /** "#geral" or "@Ana", used in the placeholder. */
  target: string
  canSend: boolean
  inputRef: Ref<HTMLTextAreaElement>
}) {
  const [value, setValue] = useState(() => drafts.get(channelId) ?? '')
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const lastTyping = useRef(0)
  const replyToId = useUi((st) => st.replyTo[channelId])
  const reply = useData((st) => (replyToId ? st.messages[channelId]?.byId[replyToId] : undefined))
  const replyName = useData((st) => (reply ? displayName(st, reply.author.id, spaceId) : ''))
  const users = useData((st) => st.users)

  const setRefs = (el: HTMLTextAreaElement | null) => {
    ref.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el
  }

  useEffect(() => {
    drafts.set(channelId, value)
  }, [channelId, value])

  // Autosize: grow with content up to ~40% of the window, then scroll.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`
  }, [value])

  // Focus the composer when a reply starts.
  useEffect(() => {
    if (replyToId) ref.current?.focus()
  }, [replyToId])

  const over = value.length - MAX_LEN
  const remaining = MAX_LEN - value.length

  const submit = () => {
    const content = value.trim()
    if (!content || over > 0 || !canSend) return
    setValue('')
    lastTyping.current = 0
    useUi.getState().setReplyTo(channelId, undefined)
    // Failure keeps the message in the list with retry/discard; nothing else to do here.
    sendMessage(channelId, content, replyToId).catch((e: unknown) => console.warn('[send] failed', e))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && replyToId) {
      e.preventDefault()
      e.stopPropagation()
      useUi.getState().setReplyTo(channelId, undefined)
    } else if (e.key === 'ArrowUp' && value === '') {
      // ↑ on an empty composer edits your last message.
      const d = useData.getState()
      const list = d.messages[channelId]
      const last = list?.ids.findLast((id) => list.byId[id]?.author.id === d.me?.id && list.byId[id]?.nonce !== id)
      if (last) {
        e.preventDefault()
        useUi.getState().setEditing(channelId, last)
      }
    }
  }

  const onChange = (v: string) => {
    setValue(v)
    const now = Date.now()
    if (v.trim() && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now
      typing(channelId).catch(() => undefined)
    }
  }

  return (
    <div className={s.composerWrap}>
      <div className={`${s.composer} ${over > 0 ? s.composerOver : ''} ${!canSend ? s.composerDisabled : ''}`}>
        {reply && (
          <div className={s.replyBar}>
            <span>
              {t.replyingTo} <strong>{replyName}</strong>
              <span className={s.replyBarText}> {toPlainText(reply.content, (id) => users[id]?.displayName ?? t.unknownUser)}</span>
            </span>
            <IconButton icon={X} label={t.cancelReply} shortcut="Esc" size="sm" onClick={() => useUi.getState().setReplyTo(channelId, undefined)} />
          </div>
        )}
        <div className={s.inputRow}>
          <textarea
            ref={setRefs}
            className={s.input}
            rows={1}
            value={value}
            disabled={!canSend}
            placeholder={canSend ? t.placeholder(target) : t.noPermission}
            aria-label={t.placeholder(target)}
            aria-describedby={remaining <= 400 ? `${channelId}-count` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {remaining <= 400 && (
            <span id={`${channelId}-count`} className={`${s.counter} tnum ${over > 0 ? s.counterOver : ''}`} aria-live="polite">
              {over > 0 ? `-${over}` : remaining}
            </span>
          )}
          <IconButton
            icon={SendHorizontal}
            label={t.send}
            shortcut={t.sendHint}
            disabledReason={over > 0 ? t.tooLong(over) : undefined}
            className={value.trim() && over <= 0 ? s.sendReady : s.sendIdle}
            onClick={submit}
          />
        </div>
      </div>
    </div>
  )
}
