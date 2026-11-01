import type { Message } from '@alga/shared'
import { Copy, CornerUpLeft, Pencil, SmilePlus, Trash2, AlertCircle } from 'lucide-react'
import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { copyText } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { clock, fullDate, messageTime } from '@/lib/format'
import { toPlainText } from '@/lib/markdown'
import { deleteMessage, discardSend, editMessage, react, retrySend } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName, roleColor } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Button, contextMenuHandler, Icon, IconButton, Modal, Tooltip, toast, type MenuEntry } from '@/ui'
import { Markdown } from './Markdown'
import { QUICK_EMOJI, t } from './strings'
import s from './chat.module.css'

/** Message pending delete confirmation (one at a time, app-wide). */
export const useDeleteConfirm = create<{ target: Message | null }>()(() => ({ target: null }))

async function remove(m: Message) {
  try {
    await deleteMessage(m.channelId, m.id)
  } catch (e) {
    toast.error(errorText(e, t.error))
  }
}
/** Shift+click skips the confirmation (power users), like the hint in the dialog says. */
export const requestDelete = (m: Message, skip = false) => (skip ? void remove(m) : useDeleteConfirm.setState({ target: m }))

const toggleReaction = (m: Message, emoji: string) => {
  const mine = m.reactions.find((r) => r.emoji === emoji)?.me ?? false
  react(m.channelId, m.id, emoji, !mine).catch((e: unknown) => toast.error(errorText(e, t.error)))
}

export const MessageItem = memo(function MessageItem({
  message: m,
  head,
  spaceId,
  meId,
  mentioned,
  failed,
  editing,
}: {
  message: Message
  head: boolean
  spaceId: string | null
  meId: string | undefined
  mentioned: boolean
  failed: boolean
  editing: boolean
}) {
  const mine = m.author.id === meId
  const pending = m.nonce === m.id
  const name = useData((st) => displayName(st, m.author.id, spaceId))
  const color = useData((st) => (spaceId ? roleColor(st, spaceId, m.author.id) : null))
  const at = new Date(m.createdAt)

  const menu = (): MenuEntry[] => {
    if (pending) return []
    const items: MenuEntry[] = [
      { label: t.actions.reply, icon: CornerUpLeft, onSelect: () => useUi.getState().setReplyTo(m.channelId, m.id) },
      { label: t.actions.copy, icon: Copy, onSelect: () => void copyText(m.content) },
    ]
    if (mine) {
      items.push(
        { kind: 'separator' },
        { label: t.actions.edit, icon: Pencil, onSelect: () => useUi.getState().setEditing(m.channelId, m.id) },
        { label: t.actions.delete, icon: Trash2, danger: true, onSelect: () => requestDelete(m) },
      )
    }
    return items
  }

  return (
    <div
      className={`${s.msg} ${head ? s.head : ''} ${mentioned ? s.mentioned : ''} ${editing ? s.editingRow : ''}`}
      data-message-id={m.id}
      onContextMenu={contextMenuHandler(menu)}
    >
      {m.replyToId && <ReplyPreview channelId={m.channelId} replyToId={m.replyToId} spaceId={spaceId} />}
      <div className={s.gutter}>
        {head ? (
          <Avatar user={m.author} size={36} decorative />
        ) : (
          <Tooltip content={fullDate(at)}>
            <time className={`${s.hoverTime} tnum`} dateTime={m.createdAt}>
              {clock(at)}
            </time>
          </Tooltip>
        )}
      </div>
      <div className={s.body}>
        {head && (
          <div className={s.meta}>
            <span className={s.author} style={color ? { color } : undefined}>
              {name}
            </span>
            <Tooltip content={fullDate(at)}>
              <time className={`${s.time} tnum`} dateTime={m.createdAt}>
                {messageTime(at)}
              </time>
            </Tooltip>
          </div>
        )}
        {editing ? (
          <InlineEditor message={m} />
        ) : (
          <div className={`${s.content} ${pending && !failed ? s.pending : ''} ${failed ? s.failedText : ''}`} data-selectable>
            <Markdown source={m.content} />
            {m.editedAt && (
              <Tooltip content={t.editedAt(fullDate(new Date(m.editedAt)))}>
                <span className={s.edited}> {t.edited}</span>
              </Tooltip>
            )}
          </div>
        )}
        {failed && (
          <div className={s.failed} role="alert">
            <Icon icon={AlertCircle} size={14} />
            {t.failed}
            <button type="button" className={s.failedAction} onClick={() => retrySend(m.channelId, m.id).catch(() => undefined)}>
              {t.retry}
            </button>
            ·
            <button type="button" className={s.failedAction} onClick={() => discardSend(m.channelId, m.id)}>
              {t.discard}
            </button>
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className={s.reactions}>
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`${s.reaction} ${r.me ? s.reactionMe : ''}`}
                aria-pressed={r.me}
                aria-label={t.reactionLabel(r.emoji, r.count, r.me)}
                onClick={() => toggleReaction(m, r.emoji)}
              >
                <span className={s.reactionEmoji}>{r.emoji}</span>
                <span className="tnum">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!pending && !editing && (
        <div className={s.toolbar} role="toolbar" aria-label="Ações da mensagem">
          {QUICK_EMOJI.map((e) => (
            <Tooltip key={e} content={t.actions.react(e)}>
              <button type="button" className={s.toolEmoji} aria-label={t.actions.react(e)} onClick={() => toggleReaction(m, e)}>
                {e}
              </button>
            </Tooltip>
          ))}
          <span className={s.toolSep} />
          <IconButton icon={CornerUpLeft} label={t.actions.reply} onClick={() => useUi.getState().setReplyTo(m.channelId, m.id)} />
          {mine && <IconButton icon={Pencil} label={t.actions.edit} onClick={() => useUi.getState().setEditing(m.channelId, m.id)} />}
          {mine && <IconButton icon={Trash2} label={t.actions.delete} className={s.toolDanger} onClick={(e) => requestDelete(m, e.shiftKey)} />}
        </div>
      )}
    </div>
  )
})

function ReplyPreview({ channelId, replyToId, spaceId }: { channelId: string; replyToId: string; spaceId: string | null }) {
  const target = useData((st) => st.messages[channelId]?.byId[replyToId])
  const name = useData((st) => (target ? displayName(st, target.author.id, spaceId) : ''))
  const users = useData((st) => st.users)
  const jump = () => {
    const el = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(replyToId)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' })
    el.classList.add(s.flash!)
    setTimeout(() => el.classList.remove(s.flash!), 1200)
  }
  return (
    <div className={s.reply}>
      <span className={s.replyLine} aria-hidden />
      {target ? (
        <button type="button" className={s.replyBody} onClick={jump}>
          <Avatar user={target.author} size={16} decorative />
          <span className={s.replyName}>{name}</span>
          <span className={s.replyText}>{toPlainText(target.content, (id) => users[id]?.displayName ?? t.unknownUser)}</span>
        </button>
      ) : (
        <span className={`${s.replyBody} ${s.replyMissing}`}>{t.replyMissing}</span>
      )}
    </div>
  )
}

function InlineEditor({ message: m }: { message: Message }) {
  const [value, setValue] = useState(m.content)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const cancel = () => useUi.getState().setEditing(m.channelId, undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value])

  const save = async () => {
    const next = value.trim()
    if (next === m.content.trim()) return cancel()
    if (!next) {
      cancel()
      return requestDelete(m)
    }
    if (next.length > 4000) return
    setBusy(true)
    try {
      await editMessage(m.channelId, m.id, next)
      cancel()
    } catch (e) {
      toast.error(errorText(e, t.error))
      setBusy(false)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
  }
  return (
    <div className={s.editor}>
      <textarea ref={ref} className={s.editInput} value={value} rows={1} disabled={busy} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} aria-label={t.actions.edit} />
      <p className={s.editHint}>
        <kbd>{t.editHint.esc}</kbd> {t.editHint.cancel} · <kbd>{t.editHint.enter}</kbd> {t.editHint.save}
      </p>
    </div>
  )
}

export function DeleteConfirm() {
  const target = useDeleteConfirm((st) => st.target)
  const [shown, setShown] = useState<Message | null>(null)
  useEffect(() => {
    if (target) setShown(target)
  }, [target])
  const close = () => useDeleteConfirm.setState({ target: null })
  const m = target ?? shown
  return (
    <Modal
      open={!!target}
      onClose={close}
      title={t.deleteTitle}
      description={t.deleteBody}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          <Button
            variant="danger"
            data-autofocus
            onClick={() => {
              if (target) void remove(target)
              close()
            }}
          >
            {t.deleteConfirm}
          </Button>
        </>
      }
    >
      {m && (
        <>
          <div className={s.deletePreview}>
            <Avatar user={m.author} size={24} decorative />
            <div style={{ minWidth: 0 }}>
              <div className={s.author}>{m.author.displayName}</div>
              <div className={s.content}>
                <Markdown source={m.content} />
              </div>
            </div>
          </div>
          <p className={s.deleteTip}>{t.deleteTip}</p>
        </>
      )}
    </Modal>
  )
}
