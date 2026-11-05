import type { Message } from '@alga/shared'
import { Copy, CornerUpLeft, MoreHorizontal, Pencil, SmilePlus, Trash2, AlertCircle, Clock } from '@/ui/icons'
import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { create } from 'zustand'
import { copyText } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { clock, fullDate } from '@/lib/format'
import { toPlainText } from '@/lib/markdown'
import { deleteMessage, discardSend, editMessage, react, retrySend } from '@/store/actions'
import { useData } from '@/store/data'
import { canDeleteMessage, displayName, presenceOf, roleColor } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Button, contextMenuHandler, Icon, IconButton, Kbd, MenuButton, Modal, Tooltip, toast, type MenuEntry } from '@/ui'
import { PersonPopover } from '../shell/MemberList'
import { messageReportEntries } from '../trust/Report'
import { Attachments, attachmentSummary } from './Attachments'
import { authorFace, authorName, isRemovedAuthor } from './author'
import { EmojiPicker } from './EmojiPicker'
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
  onJump,
}: {
  message: Message
  head: boolean
  spaceId: string | null
  meId: string | undefined
  mentioned: boolean
  /** Send failed: true, or the server's reason. */
  failed: boolean | string
  editing: boolean
  /** Scroll to (and flash) another message of the list, mounting it if needed. */
  onJump: (messageId: string) => void
}) {
  const mine = m.author.id === meId
  const canDelete = useData((st) => canDeleteMessage(st, m.author.id, spaceId))
  const pending = m.nonce === m.id
  const name = useData((st) => authorName(m.author.id, (id) => displayName(st, id, spaceId)))
  const color = useData((st) => (spaceId && !isRemovedAuthor(m.author.id) ? roleColor(st, spaceId, m.author.id) : null))
  // Compact without avatars (Aparência): IRC-like line, the time takes the avatar's place.
  const irc = useUi((st) => st.density === 'compact' && !st.compactAvatars)
  const at = new Date(m.createdAt)
  const row = useRef<HTMLDivElement>(null)
  const [pickerAt, setPickerAt] = useState<HTMLElement | null>(null)
  // Click the author (name or face) for their card: the same profile and ways to reach them as the member list.
  const [profileAt, setProfileAt] = useState<HTMLElement | null>(null)
  const removed = isRemovedAuthor(m.author.id)
  const openProfile = removed ? undefined : (e: { currentTarget: HTMLElement }) => setProfileAt(profileAt ? null : e.currentTarget)

  // Grouped by label, not by lines; only actions that really exist (no fake "Fixar"/"Denunciar" without a backend).
  const menu = (): MenuEntry[] => {
    if (pending) return []
    const items: MenuEntry[] = [
      { label: t.emoji.react, icon: SmilePlus, onSelect: () => setPickerAt(row.current?.querySelector<HTMLElement>('[data-react-anchor]') ?? row.current) },
      { label: t.actions.reply, icon: CornerUpLeft, onSelect: () => useUi.getState().setReplyTo(m.channelId, m.id) },
    ]
    if (m.content) {
      items.push(
        { kind: 'group', label: t.actions.copyGroup },
        { label: t.actions.copy, icon: Copy, onSelect: () => void copyText(toPlainText(m.content, (id) => displayName(useData.getState(), id, spaceId))) },
      )
    }
    if (mine) {
      items.push(
        { kind: 'group', label: t.actions.yours },
        { label: t.actions.edit, icon: Pencil, onSelect: () => useUi.getState().setEditing(m.channelId, m.id) },
        { label: t.actions.delete, icon: Trash2, danger: true, onSelect: () => requestDelete(m) },
      )
    } else if (canDelete) {
      items.push({ kind: 'group', label: t.actions.moderation }, { label: t.actions.delete, icon: Trash2, danger: true, onSelect: () => requestDelete(m) })
    }
    items.push(...messageReportEntries(m))
    return items
  }

  return (
    <div
      ref={row}
      className={`${s.msg} ${head ? s.head : ''} ${irc ? s.irc : ''} ${mentioned ? s.mentioned : ''} ${editing ? s.editingRow : ''}`}
      data-message-id={m.id}
      onContextMenu={contextMenuHandler(menu, t.actions.menu)}
    >
      {profileAt && <AuthorPopover userId={m.author.id} spaceId={spaceId} name={name} anchor={profileAt} onClose={() => setProfileAt(null)} />}
      {m.replyToId && <ReplyPreview channelId={m.channelId} replyToId={m.replyToId} spaceId={spaceId} onJump={onJump} />}
      <div className={s.gutter}>
        {head && !irc ? (
          <button type="button" className={s.face} tabIndex={-1} aria-hidden onClick={openProfile}>
            <Avatar user={authorFace(m.author)} size={36} decorative />
          </button>
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
            <button type="button" className={s.author} style={color ? { color } : undefined} aria-haspopup="dialog" aria-expanded={!!profileAt} onClick={openProfile} disabled={removed}>
              {name}
            </button>
            {!irc && (
              <Tooltip content={fullDate(at)}>
                <time className={`${s.time} tnum`} dateTime={m.createdAt}>
                  {clock(at)}
                </time>
              </Tooltip>
            )}
          </div>
        )}
        {editing ? (
          <InlineEditor message={m} />
        ) : (
          m.content && (
            <div className={`${s.content} ${pending && !failed ? s.pending : ''} ${failed ? s.failedText : ''}`} data-selectable>
              <Markdown source={m.content} spaceId={spaceId} />
              {m.editedAt && (
                <Tooltip content={t.editedAt(fullDate(new Date(m.editedAt)))}>
                  <span className={s.edited}> {t.edited}</span>
                </Tooltip>
              )}
            </div>
          )
        )}
        {m.attachments.length > 0 && <Attachments message={m} />}
        {failed === true ? (
          // No connection: not an error you caused. It waits, and goes out by itself when the link is back.
          <div className={s.queued} role="status">
            <Icon icon={Clock} size={14} />
            {t.queued}
            <button type="button" className={s.failedAction} onClick={() => retrySend(m.channelId, m.id).catch(() => undefined)}>
              {t.retryNow}
            </button>
            <span className={s.failedSep}>·</span>
            <button type="button" className={s.failedAction} onClick={() => discardSend(m.channelId, m.id)}>
              {t.discard}
            </button>
          </div>
        ) : failed && (
          <div className={s.failed} role="alert">
            <Icon icon={AlertCircle} size={14} />
            {t.failed}
            {typeof failed === 'string' && <span className={s.failedReason}>{failed}</span>}
            <button type="button" className={s.failedAction} onClick={() => retrySend(m.channelId, m.id).catch(() => undefined)}>
              {t.retry}
            </button>
            <span className={s.failedSep}>·</span>
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
            <Tooltip content={t.emoji.react}>
              <button type="button" className={`${s.reaction} ${s.reactionAdd}`} aria-label={t.emoji.react} onClick={(e) => setPickerAt(e.currentTarget)}>
                <Icon icon={SmilePlus} size={14} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {!pending && !editing && (
        <div className={s.toolbar} role="toolbar" aria-label={t.actions.menu}>
          {QUICK_EMOJI.map((e) => (
            <Tooltip key={e} content={t.actions.react(e)}>
              <button type="button" className={s.toolEmoji} aria-label={t.actions.react(e)} onClick={() => toggleReaction(m, e)}>
                {e}
              </button>
            </Tooltip>
          ))}
          <IconButton icon={SmilePlus} label={t.emoji.react} data-react-anchor onClick={(e) => setPickerAt(e.currentTarget)} />
          <span className={s.toolSep} />
          <IconButton icon={CornerUpLeft} label={t.actions.reply} onClick={() => useUi.getState().setReplyTo(m.channelId, m.id)} />
          {mine && <IconButton icon={Pencil} label={t.actions.edit} onClick={() => useUi.getState().setEditing(m.channelId, m.id)} />}
          {canDelete && <IconButton icon={Trash2} label={t.actions.delete} className={s.toolDanger} onClick={(e) => requestDelete(m, e.shiftKey)} />}
          <MenuButton items={menu} align="end" label={t.actions.more}>
            <IconButton icon={MoreHorizontal} label={t.actions.more} />
          </MenuButton>
        </div>
      )}
      <EmojiPicker
        anchor={pickerAt}
        side="bottom"
        onClose={() => setPickerAt(null)}
        onPick={(e) => {
          setPickerAt(null)
          toggleReaction(m, e)
        }}
      />
    </div>
  )
})

function AuthorPopover({ userId, spaceId, name, anchor, onClose }: { userId: string; spaceId: string | null; name: string; anchor: HTMLElement; onClose: () => void }) {
  const user = useData((st) => st.users[userId])
  const presence = useData((st) => presenceOf(st, userId))
  if (!user) return null
  return <PersonPopover user={user} spaceId={spaceId} name={name} presence={presence} anchor={anchor} onClose={onClose} side="right" />
}

function ReplyPreview({ channelId, replyToId, spaceId, onJump }: { channelId: string; replyToId: string; spaceId: string | null; onJump: (id: string) => void }) {
  const target = useData((st) => st.messages[channelId]?.byId[replyToId])
  const name = useData((st) => (target ? authorName(target.author.id, (id) => displayName(st, id, spaceId)) : ''))
  const jump = () => onJump(replyToId)
  return (
    <div className={s.reply}>
      <span className={s.replyLine} aria-hidden />
      {target ? (
        <button type="button" className={s.replyBody} onClick={jump}>
          <Icon icon={CornerUpLeft} size={12} />
          <span className={s.replyName}>{name}</span>
          <span aria-hidden>·</span>
          <span className={s.replyText}>{target.content ? toPlainText(target.content, (id) => displayName(useData.getState(), id, spaceId)) : attachmentSummary(target)}</span>
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
      // Clearing the text of a message with files keeps the files (the server needs some text to edit).
      return m.attachments.length ? undefined : requestDelete(m)
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
        <Kbd>{t.editHint.esc}</Kbd> {t.editHint.cancel} · <Kbd>{t.editHint.enter}</Kbd> {t.editHint.save}
      </p>
    </div>
  )
}

export function DeleteConfirm() {
  const target = useDeleteConfirm((st) => st.target)
  const meId = useData((st) => st.me?.id)
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
      description={m && m.author.id !== meId ? t.deleteBodyOf(authorName(m.author.id, () => m.author.displayName)) : t.deleteBody}
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
            <Avatar user={authorFace(m.author)} size={24} decorative />
            <div style={{ minWidth: 0 }}>
              <div className={s.author}>{authorName(m.author.id, () => m.author.displayName)}</div>
              <div className={s.content}>{m.content ? <Markdown source={m.content} /> : attachmentSummary(m)}</div>
            </div>
          </div>
          <p className={s.deleteTip}>{t.deleteTip}</p>
        </>
      )}
    </Modal>
  )
}
