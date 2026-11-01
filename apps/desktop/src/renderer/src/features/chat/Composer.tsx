import type { PublicUser } from '@alga/shared'
import { Paperclip, SendHorizontal, Smile, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react'
import { fold } from '@/lib/fuzzy'
import { toPlainText } from '@/lib/markdown'
import { sendMessage, typing } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Avatar, IconButton } from '@/ui'
import { AttachmentTray, attachmentSummary } from './Attachments'
import { authorName } from './author'
import { EmojiPicker } from './EmojiPicker'
import { encodeMentions } from './mentions'
import { addFiles, namePasted, takeFiles, useTray, type TrayItem } from './tray'
import { t } from './strings'
import s from './chat.module.css'

interface Candidate {
  user: PublicUser
  name: string
}
const MENTION_RE = /(?:^|\s)@([\p{L}\p{N}_.]{0,32})$/u
const MAX_SUGGESTIONS = 8

/** Who you can @mention here: the space's members, or the DM's other recipients. */
function useCandidates(channelId: string, spaceId: string | null): Candidate[] {
  const members = useData((st) => (spaceId ? st.members[spaceId] : undefined))
  const channel = useData((st) => st.channels[channelId])
  const users = useData((st) => st.users)
  const meId = useData((st) => st.me?.id)
  return useMemo(() => {
    if (spaceId) return Object.values(members ?? {}).filter((m) => m.user.id !== meId).map((m) => ({ user: m.user, name: m.nickname || m.user.displayName }))
    return (channel?.recipientIds ?? []).filter((id) => id !== meId && users[id]).map((id) => ({ user: users[id]!, name: users[id]!.displayName }))
  }, [spaceId, members, channel, users, meId])
}

export const MAX_LEN = 4000
const TYPING_EVERY_MS = 8000
/** Drafts survive channel switches (in-memory for the session). */
const drafts = new Map<string, string>()
const NO_FILES: TrayItem[] = []
export function Composer({
  channelId,
  spaceId,
  target,
  canSend,
  canAttach,
  inputRef,
}: {
  channelId: string
  spaceId: string | null
  /** "#geral" or "@Ana", used in the placeholder. */
  target: string
  canSend: boolean
  /** ATTACH_FILES in a space (always true in DMs). */
  canAttach: boolean
  inputRef: Ref<HTMLTextAreaElement>
}) {
  const [value, setValue] = useState(() => drafts.get(channelId) ?? '')
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const lastTyping = useRef(0)
  const replyToId = useUi((st) => st.replyTo[channelId])
  const reply = useData((st) => (replyToId ? st.messages[channelId]?.byId[replyToId] : undefined))
  const replyName = useData((st) => (reply ? authorName(reply.author.id, (id) => displayName(st, id, spaceId)) : ''))
  const users = useData((st) => st.users)
  const offline = useSession((st) => st.gateway === 'reconnecting')
  const candidates = useCandidates(channelId, spaceId)
  const picked = useRef(new Map<string, string>())
  /** Caret to restore once an insertion (mention, emoji) is committed to the DOM. */
  const caret = useRef<number | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null)
  const [emojiAt, setEmojiAt] = useState<HTMLElement | null>(null)
  const files = useTray((st) => st.byChannel[channelId]) ?? NO_FILES
  const sendableFiles = files.some((f) => !f.problem)
  const picker = useRef<HTMLInputElement>(null)
  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = fold(mention.query)
    return candidates
      .filter((c) => !q || fold(c.name).split(/\s+/).some((w) => w.startsWith(q)) || fold(c.user.username).startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, MAX_SUGGESTIONS)
  }, [mention, candidates])

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

  // Same commit as the new value, before the next keystroke: a frame later, keys typed in between land at the end.
  useLayoutEffect(() => {
    const el = ref.current
    const at = caret.current
    if (!el || at === null) return
    caret.current = null
    el.focus()
    el.setSelectionRange(at, at)
  })

  // Focus the composer when a reply starts.
  useEffect(() => {
    if (replyToId) ref.current?.focus()
  }, [replyToId])

  const over = value.length - MAX_LEN
  const remaining = MAX_LEN - value.length

  const submit = () => {
    const content = encodeMentions(value.trim(), picked.current)
    if ((!content && !sendableFiles) || over > 0 || !canSend) return
    const outgoing = takeFiles(channelId)
    setValue('')
    setMention(null)
    picked.current.clear()
    lastTyping.current = 0
    useUi.getState().setReplyTo(channelId, undefined)
    // Failure keeps the message in the list with retry/discard; nothing else to do here.
    sendMessage(channelId, content, replyToId, undefined, outgoing).catch((e: unknown) => console.warn('[send] failed', e))
  }

  // Pasted screenshots/images become attachments; text (even with an image alongside, e.g. from Word) pastes as text.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const list = Array.from(e.clipboardData.files)
    if (!list.length || e.clipboardData.types.includes('text/plain') || !canAttach) return
    e.preventDefault()
    addFiles(channelId, list.map((f) => namePasted(f, t.files.pasted)))
  }

  const pick = (c: Candidate) => {
    const el = ref.current
    if (!el || !mention) return
    const insert = `@${c.name} `
    const next = value.slice(0, mention.start) + insert + value.slice(el.selectionStart)
    picked.current.set(c.name, c.user.id)
    caret.current = mention.start + insert.length
    setValue(next)
    setMention(null)
  }

  const insertEmoji = (emoji: string) => {
    const el = ref.current
    const at = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    caret.current = at + emoji.length
    setValue(value.slice(0, at) + emoji + value.slice(end))
    setEmojiAt(null)
  }

  /** Re-read the "@query" right before the caret (typing, clicking). */
  const trackMention = (el: HTMLTextAreaElement) => {
    const m = MENTION_RE.exec(el.value.slice(0, el.selectionStart))
    if (!m || candidates.length === 0) return setMention(null)
    const start = el.selectionStart - m[1]!.length - 1
    setMention((cur) => ({ start, query: m[1]!, index: cur && cur.start === start ? cur.index : 0 }))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (mention && suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setMention({ ...mention, index: (mention.index + d + suggestions.length) % suggestions.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(suggestions[Math.min(mention.index, suggestions.length - 1)]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setMention(null)
        return
      }
    }
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

  const onChange = (v: string, el: HTMLTextAreaElement) => {
    setValue(v)
    trackMention(el)
    const now = Date.now()
    if (v.trim() && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now
      typing(channelId).catch(() => undefined)
    }
  }

  const listId = `${channelId}-mentions`
  const active = mention && suggestions.length ? suggestions[Math.min(mention.index, suggestions.length - 1)] : undefined
  return (
    <div className={s.composerWrap}>
      {mention && suggestions.length > 0 && (
        <div className={s.mentions} role="listbox" id={listId} aria-label={t.mentions.title}>
          <div className={s.mentionsHead}>{t.mentions.title}</div>
          {suggestions.map((c, i) => (
            <button
              key={c.user.id}
              id={`${listId}-${c.user.id}`}
              type="button"
              role="option"
              aria-selected={i === mention.index}
              tabIndex={-1}
              className={s.mentionRow}
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setMention({ ...mention, index: i })}
              onClick={() => pick(c)}
            >
              <Avatar user={c.user} size={20} decorative />
              <span className={s.mentionName}>{c.name}</span>
              <span className={s.mentionHandle}>@{c.user.username}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`${s.composer} ${over > 0 ? s.composerOver : ''} ${!canSend ? s.composerDisabled : ''}`}>
        {reply && (
          <div className={s.replyBar}>
            <span>
              {t.replyingTo} <strong>{replyName}</strong>
              <span className={s.replyBarText}> · {reply.content ? toPlainText(reply.content, (id) => users[id]?.displayName ?? t.unknownUser) : attachmentSummary(reply)}</span>
            </span>
            <IconButton icon={X} label={t.cancelReply} shortcut="Esc" size="sm" onClick={() => useUi.getState().setReplyTo(channelId, undefined)} />
          </div>
        )}
        <AttachmentTray channelId={channelId} items={files} onRemoved={() => ref.current?.focus()} />
        <div className={s.inputRow}>
          <IconButton
            icon={Paperclip}
            label={t.files.attach}
            disabledReason={!canSend ? t.noPermission : !canAttach ? t.files.noPermission : undefined}
            className={s.attachBtn}
            onClick={() => picker.current?.click()}
          />
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              addFiles(channelId, Array.from(e.target.files ?? []))
              e.target.value = ''
              ref.current?.focus()
            }}
          />
          <textarea
            ref={setRefs}
            className={s.input}
            rows={1}
            value={value}
            disabled={!canSend}
            placeholder={!canSend ? t.noPermission : offline ? t.offline : t.placeholder(target)}
            aria-label={t.placeholder(target)}
            aria-describedby={remaining <= 400 ? `${channelId}-count` : undefined}
            aria-autocomplete="list"
            aria-controls={mention && suggestions.length ? listId : undefined}
            aria-activedescendant={active ? `${listId}-${active.user.id}` : undefined}
            onChange={(e) => onChange(e.target.value, e.target)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onClick={(e) => trackMention(e.currentTarget)}
            onBlur={() => setMention(null)}
          />
          {remaining <= 400 && (
            <span id={`${channelId}-count`} className={`${s.counter} tnum ${over > 0 ? s.counterOver : ''}`} aria-live="polite">
              {over > 0 ? `-${over}` : remaining}
            </span>
          )}
          <IconButton icon={Smile} label={t.emoji.open} aria-expanded={!!emojiAt} className={s.emojiBtn} onClick={(e) => setEmojiAt(emojiAt ? null : e.currentTarget)} />
          <IconButton
            icon={SendHorizontal}
            label={t.send}
            shortcut={t.sendHint}
            disabledReason={over > 0 ? t.tooLong(over) : undefined}
            className={(value.trim() || sendableFiles) && over <= 0 ? s.sendReady : s.sendIdle}
            onClick={submit}
          />
        </div>
      </div>
      <EmojiPicker anchor={emojiAt} onClose={() => setEmojiAt(null)} onPick={insertEmoji} />
    </div>
  )
}
