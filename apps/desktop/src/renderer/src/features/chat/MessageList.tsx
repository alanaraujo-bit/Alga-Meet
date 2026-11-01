import { ArrowDown, Hash, Phone } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { buildRows } from '@/lib/grouping'
import { mentionedIds, toPlainText } from '@/lib/markdown'
import { ackLatest, loadMessages } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Button, Divider, Fronds, Icon, Skeleton } from '@/ui'
import { errorText } from '@/lib/errors'
import { t as tv } from '../voice/strings'
import { joinVoice } from '../voice/voice'
import { attachmentSummary } from './Attachments'
import { authorName } from './author'
import { MessageItem } from './MessageItem'
import { anchorAt, estimateHeight, prefixSums, segments, visibleRange, type Anchor, type Item } from './virtual'
import { t } from './strings'
import s from './chat.module.css'

const BOTTOM_SLOP = 32
const LOAD_OLDER_AT = 1000
/** Pixels mounted beyond each edge of the viewport; a re-render happens only when scrolling eats 2/3 of it. */
const OVERSCAN = 900
const reducedMotion = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
const covers = (r: [number, number], w: [number, number]) => r[0] <= w[0] && r[1] >= w[1]

/**
 * Virtualized history: only rows near the viewport are mounted (see virtual.ts for the math). Rows sit in normal
 * flow between two spacers whose heights come from rows that are not mounted, so a mounted row changing height
 * (image, reaction, edit) only needs the scroll position corrected, never a re-render.
 */
export function MessageList({ channelId, spaceId, unreadAfter, title, isDm }: { channelId: string; spaceId: string | null; unreadAfter: string | null; title: string; isDm: boolean }) {
  const list = useData((st) => st.messages[channelId])
  const failures = useData((st) => st.sendFailures)
  const me = useData((st) => st.me)
  const editingId = useUi((st) => st.editing[channelId])
  const [error, setError] = useState<string | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [farFromBottom, setFar] = useState(false)
  const [said, setSaid] = useState('')
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((n) => n + 1), [])

  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Scroll state lives in refs: stuck to the bottom, else an anchor (row key + offset) that layout changes keep still.
  const stick = useRef(true)
  const anchor = useRef<Anchor | null>(null)
  const sizes = useRef(new Map<string, number>())
  const view = useRef({ w: 0, h: 0, pad: -1 })
  const layout = useRef({ items: [] as Item[], version: 0, built: -1, width: -1, offs: new Float64Array(1) as Float64Array, index: new Map<string, number>() })
  const rendered = useRef<[number, number]>([0, 0])
  const spins = useRef(0)
  const lastId = useRef('')
  const focused = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const pendingFlash = useRef<string | null>(null)

  const messages = useMemo(() => (list ? list.ids.map((id) => list.byId[id]!) : []), [list])
  const rows = useMemo(() => buildRows(messages, { unreadAfter, meId: me?.id }), [messages, unreadAfter, me?.id])
  const headerKind = !list ? null : error ? 'error' : list.loading && list.ids.length > 0 ? 'older' : !list.hasMoreBefore ? 'intro' : null
  const items = useMemo<Item[]>(() => (headerKind ? [{ kind: headerKind, key: headerKind } as Item, ...rows] : rows), [headerKind, rows])
  // aria-posinset of each message row (1 = oldest loaded) and how many are loaded.
  const [ordinal, count] = useMemo(() => {
    const o = new Int32Array(items.length)
    let n = 0
    items.forEach((it, i) => it.kind === 'message' && (o[i] = ++n))
    return [o, n] as const
  }, [items])

  /** Offsets of `its` (cached until the items, a measured size or the width change). */
  const offsets = (its: Item[]): Float64Array => {
    const L = layout.current
    const w = view.current.w || 800
    if (L.items !== its || L.built !== L.version || L.width !== w) {
      if (L.items !== its) L.index = new Map(its.map((it, i) => [it.key, i]))
      L.offs = prefixSums(its.map((it) => sizes.current.get(it.key) ?? estimateHeight(it, w)))
      Object.assign(L, { items: its, built: L.version, width: w })
    }
    return L.offs
  }
  /** Mounted rows' real heights into the size map. Spacers only depend on unmounted rows, so the DOM stays consistent. */
  const measure = (): boolean => {
    let changed = false
    for (const node of content.current?.children ?? []) {
      const key = (node as HTMLElement).dataset.key
      if (!key) continue
      const h = node.getBoundingClientRect().height
      if (Math.abs((sizes.current.get(key) ?? -1) - h) > 0.25) {
        sizes.current.set(key, h)
        changed = true
      }
    }
    if (changed) layout.current.version++
    return changed
  }
  const restore = () => {
    const el = scroller.current
    if (!el) return
    const offs = offsets(layout.current.items)
    const a = anchor.current
    const i = a ? layout.current.index.get(a.key) : undefined
    const top = stick.current ? el.scrollHeight : a && i !== undefined ? view.current.pad + offs[i]! + a.delta : null
    if (top === null || Math.abs(el.scrollTop - top) < 1) return
    el.scrollTop = top
    // Clamped at an edge: re-anchor on where we really are, so the next render converges.
    if (!stick.current && Math.abs(el.scrollTop - top) >= 1) anchor.current = anchorAt(layout.current.items, offs, el.scrollTop - view.current.pad)
  }

  const load = useCallback(() => {
    setError(null)
    loadMessages(channelId).catch((e: unknown) => setError(errorText(e, t.loadError)))
  }, [channelId])
  const maybeLoad = () => {
    const el = scroller.current
    const l = useData.getState().messages[channelId]
    if (el && el.scrollTop < LOAD_OLDER_AT && l?.hasMoreBefore && !l.loading && l.ids.length > 0 && !error) load()
  }

  // First page (or top-up when only live messages arrived before opening).
  useEffect(() => {
    const l = useData.getState().messages[channelId]
    if (!l || (l.hasMoreBefore && l.ids.length < 50)) load()
  }, [channelId, load])

  const ack = useCallback(() => {
    if (stick.current && document.hasFocus()) ackLatest(channelId)
  }, [channelId])
  useEffect(() => {
    window.addEventListener('focus', ack)
    return () => window.removeEventListener('focus', ack)
  }, [ack])

  // Observers call the latest closures (they are created once).
  const latest = useRef({ measure, restore, rerender })
  latest.current = { measure, restore, rerender }
  const rowObserver = useRef<ResizeObserver | null>(null)
  const track = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    // Late size changes of mounted rows (images, fonts): fix the scroll before paint, re-render for the range only.
    rowObserver.current ??= new ResizeObserver(() => {
      const f = latest.current
      if (!f.measure()) return
      f.restore()
      f.rerender()
    })
    const ro = rowObserver.current
    ro.observe(el)
    return () => ro.unobserve(el)
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const v = view.current
      if (v.w === el.clientWidth && v.h === el.clientHeight) return
      // shortcut: heights measured at another width stay until their row mounts again (scrollbar slightly off meanwhile).
      const widthChanged = v.w !== el.clientWidth
      Object.assign(v, { w: el.clientWidth, h: el.clientHeight })
      // A new width changes the estimates behind the spacers: restore after the re-render (layout effect), not now.
      if (!widthChanged) latest.current.restore()
      latest.current.rerender()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      rowObserver.current?.disconnect()
    }
  }, [])

  const el = scroller.current
  const offs = offsets(items)
  const L = layout.current
  const vh = view.current.h || window.innerHeight
  const ai = anchor.current ? L.index.get(anchor.current.key) : undefined
  const top = stick.current ? offs[items.length]! - vh : anchor.current && ai !== undefined ? offs[ai]! + anchor.current.delta : (el?.scrollTop ?? 0) - Math.max(0, view.current.pad)
  const range = visibleRange(offs, top, vh, OVERSCAN)
  const editKey = editingId ? (list?.byId[editingId]?.nonce ?? editingId) : null
  const pinned = [focused.current, pendingFocus.current, editKey].map((k) => (k ? (L.index.get(k) ?? -1) : -1))
  const segs = segments(offs, range, pinned)
  // Roving tab stop: the focused message, else the newest mounted one.
  let tabKey = focused.current
  for (let i = range[1] - 1; !tabKey && i >= range[0]; i--) if (items[i]!.kind === 'message') tabKey = items[i]!.key

  useLayoutEffect(() => {
    const sc = scroller.current
    const c = content.current
    if (!sc || !c) return
    if (view.current.pad < 0) view.current.pad = parseFloat(getComputedStyle(c).paddingTop) || 0
    rendered.current = range
    measure()
    // New messages at the end: mine stick to the bottom, others count in the pill and are announced.
    const ids = list?.ids ?? []
    const prev = lastId.current
    const last = ids[ids.length - 1] ?? ''
    if (prev && last > prev) {
      let mine = false
      let n = 0
      let other = null
      for (let i = ids.length - 1; i >= 0 && ids[i]! > prev; i--, n++) {
        const m = list!.byId[ids[i]!]!
        if (m.author.id === me?.id) mine = true
        else other ??= m
      }
      if (mine) stick.current = true
      else if (!stick.current) setNewCount((x) => x + n)
      if (other) {
        const nameOf = (id: string) => displayName(useData.getState(), id, spaceId)
        setSaid(`${authorName(other.author.id, nameOf)}: ${other.content ? toPlainText(other.content, nameOf) : attachmentSummary(other)}`)
      }
    }
    lastId.current = last
    restore()
    // A deleted focused row: keep the focus in the list.
    if (focused.current && !layout.current.index.has(focused.current)) {
      focused.current = null
      if (document.activeElement === document.body) sc.focus({ preventScroll: true })
    }
    const pf = pendingFocus.current
    if (pf) {
      pendingFocus.current = null
      const node = c.querySelector<HTMLElement>(`[data-key="${CSS.escape(pf)}"]`)
      node?.focus({ preventScroll: true })
      node?.scrollIntoView({ block: 'nearest' })
    }
    const fl = pendingFlash.current
    if (fl) {
      pendingFlash.current = null
      flash(fl)
    }
    // Rows smaller than their estimate can leave a gap: mount more before paint.
    if (covers(range, visibleRange(offsets(layout.current.items), sc.scrollTop - view.current.pad, sc.clientHeight, OVERSCAN / 3))) spins.current = 0
    else if (spins.current++ < 3) rerender()
    ack()
    maybeLoad()
  })

  const flash = (id: string) => {
    const node = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
    if (!node) return
    node.classList.add(s.flash!)
    setTimeout(() => node.classList.remove(s.flash!), 1200)
  }
  /** Reply preview → original message: smooth when it is close, else an instant jump (centered) and a flash. */
  const jumpImpl = useRef((_id: string) => {})
  jumpImpl.current = (id: string) => {
    const sc = scroller.current
    const m = list?.byId[id]
    const key = m ? (m.nonce ?? m.id) : null
    const i = key ? layout.current.index.get(key) : undefined
    if (!sc || !key || i === undefined) return
    const o = offsets(layout.current.items)
    const node = sc.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
    if (node && Math.abs(view.current.pad + o[i]! - sc.scrollTop) < sc.clientHeight * 2) {
      node.scrollIntoView({ block: 'center', behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' })
      return flash(id)
    }
    stick.current = false
    anchor.current = { key, delta: -(sc.clientHeight - (o[i + 1]! - o[i]!)) / 2 }
    pendingFlash.current = id
    rerender()
  }
  const jumpTo = useCallback((id: string) => jumpImpl.current(id), [])

  const onScroll = () => {
    const sc = scroller.current
    if (!sc) return
    const dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight
    stick.current = dist < BOTTOM_SLOP
    const o = offsets(layout.current.items)
    const y = sc.scrollTop - view.current.pad
    anchor.current = anchorAt(layout.current.items, o, y)
    setFar(dist > sc.clientHeight * 1.5)
    if (stick.current) {
      setNewCount(0)
      ack()
    }
    if (!covers(rendered.current, visibleRange(o, y, sc.clientHeight, OVERSCAN / 3))) rerender()
    maybeLoad()
  }

  const jump = () => {
    const sc = scroller.current
    if (!sc) return
    const far = sc.scrollHeight - sc.scrollTop - sc.clientHeight > sc.clientHeight * 2
    stick.current = true
    setNewCount(0)
    if (far || reducedMotion()) rerender()
    else sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
  }

  /** Message rows: ↑/↓ and PageUp/PageDown move between messages, Home/End to the oldest/newest loaded. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = e.target as HTMLElement
    const key = row.getAttribute('role') === 'article' ? row.dataset.key : undefined
    const its = layout.current.items
    const i = key ? layout.current.index.get(key) : undefined
    if (i === undefined) return
    const step = (from: number, dir: 1 | -1) => {
      for (let k = from + dir; k >= 0 && k < its.length; k += dir) if (its[k]!.kind === 'message') return k
      return from
    }
    const to = { ArrowDown: step(i, 1), PageDown: step(i, 1), ArrowUp: step(i, -1), PageUp: step(i, -1), Home: step(-1, 1), End: step(its.length, -1) }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const sc = scroller.current!
    const o = offsets(its)
    const at = view.current.pad + o[to]!
    if (to === step(its.length, -1)) stick.current = true
    else if (at < sc.scrollTop || at + (o[to + 1]! - o[to]!) > sc.scrollTop + sc.clientHeight) {
      stick.current = false
      anchor.current = { key: its[to]!.key, delta: -8 }
    }
    pendingFocus.current = its[to]!.key
    rerender()
  }

  const initialLoading = !list || (list.ids.length === 0 && (list.loading || list.hasMoreBefore))
  return (
    <div className={s.listWrap}>
      <div
        ref={scroller}
        className={s.scroller}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onFocus={(e) => (focused.current = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key ?? null)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && (focused.current = null)}
        role="log"
        // Rows mount while scrolling: never announce them (new messages go through the status below).
        aria-live="off"
        aria-label={`Mensagens em ${title}`}
        aria-busy={list?.loading}
      >
        <div ref={content} className={s.listContent}>
          {initialLoading && !error ? (
            <SkeletonMessages count={7} />
          ) : (
            segs.map((sg, k) => {
              if ('gap' in sg) return <div key={`gap-${k}`} className={s.gap} style={{ height: sg.gap }} aria-hidden />
              const r = items[sg.index]!
              return (
                <div
                  key={r.key}
                  ref={track}
                  data-key={r.key}
                  data-kind={r.kind}
                  className={s.row}
                  {...(r.kind === 'message' && { role: 'article', 'aria-posinset': ordinal[sg.index], 'aria-setsize': list?.hasMoreBefore ? -1 : count, tabIndex: r.key === tabKey ? 0 : -1 })}
                >
                  {r.kind === 'intro' ? (
                    <Intro title={title} isDm={isDm} channelId={channelId} />
                  ) : r.kind === 'older' ? (
                    <SkeletonMessages count={3} label={t.loadingOlder} />
                  ) : r.kind === 'error' ? (
                    <div className={s.loadError} role="alert">
                      {error}
                      <Button size="sm" onClick={load}>
                        {t.retry}
                      </Button>
                    </div>
                  ) : r.kind === 'day' ? (
                    <div className={s.day}>
                      <Divider label={r.label} />
                    </div>
                  ) : r.kind === 'unread' ? (
                    <div className={s.unreadLine} role="separator" aria-label={t.unread}>
                      <span>{t.unread}</span>
                    </div>
                  ) : (
                    <MessageItem
                      message={r.message}
                      head={r.head}
                      spaceId={spaceId}
                      meId={me?.id}
                      mentioned={!!me && r.message.author.id !== me.id && mentionedIds(r.message.content).includes(me.id)}
                      failed={failures[r.message.id] ?? false}
                      editing={editingId === r.message.id}
                      onJump={jumpTo}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
      <div className="sr-only" role="status">
        {said}
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
  const callOn = useData((st) => Object.values(st.voiceStates).some((v) => v.channelId === channelId))
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
          {/* The call is already on screen above: the intro says so instead of offering to start another. */}
          {callOn ? (
            <span className={s.callChip}>
              <Fronds size={12} breathing />
              {tv.call.inCall}
            </span>
          ) : (
            <Button icon={Phone} onClick={() => void joinVoice(channelId)}>
              {t.intro.call}
            </Button>
          )}
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
