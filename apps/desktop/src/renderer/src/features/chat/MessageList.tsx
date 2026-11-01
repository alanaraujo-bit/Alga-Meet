import { ArrowDown, Hash, Phone } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildRows } from '@/lib/grouping'
import { mentionedIds } from '@/lib/markdown'
import { ackLatest, loadMessages } from '@/store/actions'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { Avatar, Button, Divider, Icon, Skeleton } from '@/ui'
import { errorText } from '@/lib/errors'
import { joinVoice } from '../voice/voice'
import { MessageItem } from './MessageItem'
import { t } from './strings'
import s from './chat.module.css'

const BOTTOM_SLOP = 32
const LOAD_OLDER_AT = 400

export function MessageList({ channelId, spaceId, unreadAfter, title, isDm }: { channelId: string; spaceId: string | null; unreadAfter: string | null; title: string; isDm: boolean }) {
  const list = useData((st) => st.messages[channelId])
  const failures = useData((st) => st.sendFailures)
  const me = useData((st) => st.me)
  const editingId = useUi((st) => st.editing[channelId])
  const [error, setError] = useState<string | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [farFromBottom, setFar] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const snap = useRef({ first: '', last: '', height: 0 })

  const ids = list?.ids ?? []
  const messages = useMemo(() => (list ? list.ids.map((id) => list.byId[id]!) : []), [list])
  const rows = useMemo(() => buildRows(messages, { unreadAfter, meId: me?.id }), [messages, unreadAfter, me?.id])

  const load = useCallback(() => {
    setError(null)
    loadMessages(channelId).catch((e: unknown) => setError(errorText(e, t.loadError)))
  }, [channelId])

  // First page (or top-up when only live messages arrived before opening).
  useEffect(() => {
    const l = useData.getState().messages[channelId]
    if (!l || (l.hasMoreBefore && l.ids.length < 50)) load()
  }, [channelId, load])

  const ack = useCallback(() => {
    if (atBottom.current && document.hasFocus()) ackLatest(channelId)
  }, [channelId])
  useEffect(() => {
    window.addEventListener('focus', ack)
    return () => window.removeEventListener('focus', ack)
  }, [ack])

  // Scroll anchoring: prepends keep the viewport still; appends stick to bottom when you are there.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const first = ids[0] ?? ''
    const last = ids[ids.length - 1] ?? ''
    const prev = snap.current
    if (prev.first && first && first < prev.first) {
      el.scrollTop += el.scrollHeight - prev.height
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    } else if (prev.last && last > prev.last) {
      const fresh = ids.filter((id) => id > prev.last)
      if (fresh.some((id) => list?.byId[id]?.author.id === me?.id)) {
        el.scrollTop = el.scrollHeight
        atBottom.current = true
      } else setNewCount((n) => n + fresh.length)
    }
    snap.current = { first, last, height: el.scrollHeight }
    ack()
  })

  // Late layout changes (fonts, code blocks, reactions) must not unstick the bottom.
  useEffect(() => {
    const el = scroller.current
    const c = content.current
    if (!el || !c) return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
      snap.current.height = el.scrollHeight
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottom.current = dist < BOTTOM_SLOP
    setFar(dist > el.clientHeight * 1.5)
    if (atBottom.current) {
      setNewCount(0)
      ack()
    }
    snap.current.height = el.scrollHeight
    const l = useData.getState().messages[channelId]
    if (el.scrollTop < LOAD_OLDER_AT && l?.hasMoreBefore && !l.loading && !error) load()
  }

  const jump = () => {
    const el = scroller.current
    if (!el) return
    const reduce = document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    setNewCount(0)
  }

  const initialLoading = !list || (list.ids.length === 0 && (list.loading || list.hasMoreBefore))
  return (
    <div className={s.listWrap}>
      <div ref={scroller} className={s.scroller} onScroll={onScroll} role="log" aria-label={`Mensagens em ${title}`} aria-busy={list?.loading}>
        <div ref={content} className={s.listContent}>
          {initialLoading && !error ? (
            <SkeletonMessages count={7} />
          ) : (
            <>
              {list && !list.hasMoreBefore && <Intro title={title} isDm={isDm} channelId={channelId} />}
              {list?.loading && list.ids.length > 0 && <SkeletonMessages count={3} label={t.loadingOlder} />}
              {error && (
                <div className={s.loadError} role="alert">
                  {error}
                  <Button size="sm" onClick={load}>
                    {t.retry}
                  </Button>
                </div>
              )}
              {rows.map((r) =>
                r.kind === 'day' ? (
                  <div key={r.key} className={s.day}>
                    <Divider label={r.label} />
                  </div>
                ) : r.kind === 'unread' ? (
                  <div key={r.key} className={s.unreadLine} role="separator" aria-label={t.unread}>
                    <span>{t.unread}</span>
                  </div>
                ) : (
                    <MessageItem
                      key={r.key}
                      message={r.message}
                      head={r.head}
                      spaceId={spaceId}
                      meId={me?.id}
                      mentioned={!!me && r.message.author.id !== me.id && mentionedIds(r.message.content).includes(me.id)}
                      failed={failures[r.message.id] ?? false}
                      editing={editingId === r.message.id}
                    />
                ),
              )}
            </>
          )}
        </div>
      </div>
      {(newCount > 0 || farFromBottom) && (
        <button type="button" className={s.jump} onClick={jump}>
          {newCount > 0 ? t.jumpNew(newCount) : t.jumpLatest}
          <Icon icon={ArrowDown} size={14} />
        </button>
      )}
    </div>
  )
}

function Intro({ title, isDm, channelId }: { title: string; isDm: boolean; channelId: string }) {
  const peer = useData((st) => {
    const c = st.channels[channelId]
    const id = c?.recipientIds?.find((x) => x !== st.me?.id)
    return id ? st.users[id] : undefined
  })
  return (
    <div className={s.intro}>
      <div className={s.introIcon}>{isDm && peer ? <Avatar user={peer} size={56} decorative /> : <Icon icon={Hash} size={24} />}</div>
      <h2 className={s.introTitle}>{isDm ? title : t.intro.channelTitle(title)}</h2>
      <p className={s.introBody}>{isDm ? t.intro.dmBody(peer?.displayName.split(' ')[0] ?? title) : t.intro.channelBody(title)}</p>
      {isDm && (
        <div className={s.introActions}>
          <Button icon={Phone} onClick={() => void joinVoice(channelId)}>
            {t.intro.call}
          </Button>
        </div>
      )}
    </div>
  )
}

function SkeletonMessages({ count, label }: { count: number; label?: string }) {
  const widths = [72, 46, 88, 58, 34, 80, 64]
  return (
    <div className={s.skeletons} aria-label={label} role={label ? 'status' : undefined}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.skeletonRow}>
          <Skeleton width={36} height={36} radius={18} />
          <div className={s.skeletonLines}>
            <Skeleton width={90 + ((i * 37) % 60)} height={10} />
            <Skeleton width={`${widths[i % widths.length]}%`} height={12} />
            {i % 3 === 0 && <Skeleton width={`${widths[(i + 3) % widths.length]! - 20}%`} height={12} />}
          </div>
        </div>
      ))}
    </div>
  )
}
