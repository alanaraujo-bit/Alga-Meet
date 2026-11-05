import { toPlainText, mentionedIds } from '@/lib/markdown'
import { attachmentSummary } from '../chat/Attachments'
import { isUnread, useData } from '@/store/data'
import { channelTitle, displayName } from '@/store/selectors'
import { onDispatch } from '@/store/session'
import { useUi } from '@/store/ui'
import { isMuted, levelOf, shouldNotify, startNotifyPrefs, useNotify } from './notifyPrefs'

/**
 * Desktop notifications while the window is not focused (DMs always; space messages by that space's level, see
 * notifyPrefs.ts), the taskbar badge, and click-through to the conversation. Each piece obeys its switch in
 * Configurações › Notificações; silenced spaces, channels and DMs never interrupt.
 */
export function startNotifications(): () => void {
  const b = window.alga
  const offs: Array<() => void> = [startNotifyPrefs()]

  offs.push(
    onDispatch((d) => {
      if (d.t !== 'MESSAGE_CREATE' || !useUi.getState().notifyMessages || document.hasFocus()) return
      const st = useData.getState()
      const m = d.d
      if (!st.me || m.author.id === st.me.id) return
      const ch = st.channels[m.channelId]
      if (!ch) return
      const dm = ch.type === 'dm' || ch.type === 'group_dm'
      const go = shouldNotify({
        dm,
        mentioned: mentionedIds(m.content).includes(st.me.id),
        channelMuted: isMuted(ch.id),
        level: ch.spaceId ? levelOf(ch.spaceId) : 'all',
      })
      if (!go) return
      const who = displayName(st, m.author.id, ch.spaceId)
      b?.notify?.({
        title: dm ? who : `${who} em #${channelTitle(st, ch)}`,
        body: (m.content ? toPlainText(m.content, (id) => displayName(st, id, ch.spaceId)) : attachmentSummary(m)).slice(0, 180),
        tag: `msg:${ch.id}`,
      })
    }),
  )

  // Notification clicked: open the conversation (or the call) it was about.
  if (b?.onNotificationClick)
    offs.push(
      b.onNotificationClick((tag) => {
        const id = tag?.replace(/^(msg|call):/, '')
        const ch = id ? useData.getState().channels[id] : undefined
        if (!ch) return
        if (ch.spaceId) useUi.getState().go({ kind: 'space', spaceId: ch.spaceId, channelId: ch.id })
        else useUi.getState().go({ kind: 'dm', channelId: ch.id })
      }),
    )

  // Taskbar badge = what needs you: mentions + unread DMs, minus anything you silenced.
  let last = -1
  const badge = () => {
    const st = useData.getState()
    let n = 0
    if (useUi.getState().taskbarBadge)
      for (const c of Object.values(st.channels)) {
        if (isMuted(c.id) || (c.spaceId && levelOf(c.spaceId) === 'none')) continue
        const mentions = st.readStates[c.id]?.mentionCount ?? 0
        n += c.type === 'dm' || c.type === 'group_dm' ? (isUnread(st, c.id) ? Math.max(1, mentions) : 0) : mentions
      }
    if (n !== last) b?.window?.setBadge?.((last = n))
  }
  badge()
  offs.push(useData.subscribe((s, p) => (s.readStates !== p.readStates || s.channels !== p.channels) && badge()))
  offs.push(useUi.subscribe((s, p) => s.taskbarBadge !== p.taskbarBadge && badge()))
  offs.push(useNotify.subscribe(badge))

  return () => {
    offs.forEach((off) => off())
    b?.window?.setBadge?.(0)
  }
}
