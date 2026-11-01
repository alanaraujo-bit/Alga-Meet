import { CornerDownLeft, Hash, Search, Volume2 } from '@/ui/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fuzzyScore, matchRanges } from '@/lib/fuzzy'
import { openDm } from '@/store/actions'
import { isUnread, useData, type DataState } from '@/store/data'
import { channelTitle, dmPeers, mentionCount, presenceOf } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Badge, Icon, Kbd } from '@/ui'
import { initials } from '@/ui/Avatar'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { toastError } from '../auth/VerifyEmail'
import s from './switcher.module.css'

const t = {
  label: 'Ir para',
  placeholder: 'Para onde vamos? Canais, conversas, amigos, espaços',
  empty: 'Nada encontrado. Tente outro nome.',
  hint: { nav: 'navegar', open: 'abrir', close: 'fechar', filters: '# canais · @ pessoas · * espaços' },
  sections: { needs: 'Precisa de você', dm: 'Conversas', channel: 'Canais', friend: 'Pessoas', space: 'Espaços' },
}

type Kind = 'channel' | 'voice' | 'dm' | 'friend' | 'space'
interface Item {
  id: string
  kind: Kind
  label: string
  sub?: string
  icon: ReactNode
  unread: boolean
  mentions: number
  run: () => void
}

function collect(d: DataState): Item[] {
  const ui = useUi.getState()
  const items: Item[] = []
  const dmWith = new Set<string>()
  for (const c of Object.values(d.channels)) {
    if (c.type === 'dm' || c.type === 'group_dm') {
      const peers = dmPeers(d, c)
      if (c.type === 'dm' && peers[0]) dmWith.add(peers[0].id)
      const peer = c.type === 'dm' ? peers[0] : undefined
      items.push({
        id: c.id,
        kind: 'dm',
        label: channelTitle(d, c),
        sub: peer ? `@${peer.username}` : undefined,
        icon: peer ? <Avatar user={peer} size={20} presence={presenceOf(d, peer.id)} decorative /> : <Avatar user={{ id: c.id, displayName: channelTitle(d, c), avatarUrl: null }} size={20} decorative />,
        unread: isUnread(d, c.id),
        mentions: mentionCount(d, c.id),
        run: () => ui.go({ kind: 'dm', channelId: c.id }),
      })
    } else if (c.spaceId && d.spaces[c.spaceId]) {
      const spaceId = c.spaceId
      items.push({
        id: c.id,
        kind: c.type === 'voice' ? 'voice' : 'channel',
        label: c.name,
        sub: d.spaces[spaceId]!.name,
        icon: <Icon icon={c.type === 'voice' ? Volume2 : Hash} size={16} />,
        unread: c.type === 'text' && isUnread(d, c.id),
        mentions: mentionCount(d, c.id),
        run: () => ui.go({ kind: 'space', spaceId, channelId: c.id }),
      })
    }
  }
  for (const r of Object.values(d.relationships)) {
    if (r.type !== 'friend' || dmWith.has(r.user.id)) continue
    items.push({
      id: `friend-${r.user.id}`,
      kind: 'friend',
      label: r.user.displayName,
      sub: `@${r.user.username}`,
      icon: <Avatar user={r.user} size={20} presence={presenceOf(d, r.user.id)} decorative />,
      unread: false,
      mentions: 0,
      run: () =>
        void openDm([r.user.id]).then(
          (ch) => ui.go({ kind: 'dm', channelId: ch.id }),
          (e: unknown) => toastError(e),
        ),
    })
  }
  for (const id of d.spaceOrder) {
    const sp = d.spaces[id]
    if (!sp) continue
    items.push({
      id: `space-${id}`,
      kind: 'space',
      label: sp.name,
      icon: <span className={s.spaceIcon}>{sp.iconUrl ? <img src={sp.iconUrl} alt="" draggable={false} /> : initials(sp.name)}</span>,
      unread: false,
      mentions: 0,
      run: () => ui.go({ kind: 'space', spaceId: id, channelId: ui.lastChannelBySpace[id] ?? null }),
    })
  }
  return items
}

const FILTER: Record<string, Kind[]> = { '#': ['channel', 'voice'], '@': ['dm', 'friend'], '*': ['space'] }

type SectionKey = keyof typeof t.sections
const SECTION_OF: Record<Kind, Exclude<SectionKey, 'needs'>> = { dm: 'dm', channel: 'channel', voice: 'channel', friend: 'friend', space: 'space' }
/** Without a query each section shows a few; "Precisa de você" (mentions, unread) comes first. */
const CAP: Record<SectionKey, number> = { needs: 6, dm: 5, channel: 5, friend: 4, space: 4 }

/**
 * Results under section headers. No query: what needs you, then conversations, channels, people, spaces.
 * With a query: best matches first, grouped by kind in the order their best match ranks.
 */
export function rank(items: Item[], raw: string): Array<{ key: SectionKey; items: Item[] }> {
  const f = FILTER[raw[0] ?? '']
  const q = f ? raw.slice(1) : raw
  const pool = f ? items.filter((i) => f.includes(i.kind)) : items
  const groups = new Map<SectionKey, Item[]>()
  const push = (k: SectionKey, i: Item) => {
    const list = groups.get(k) ?? []
    if (!groups.has(k)) groups.set(k, list)
    list.push(i)
  }
  if (!q.trim()) {
    const needs = pool.filter((i) => i.mentions > 0 || i.unread).sort((a, b) => b.mentions - a.mentions)
    if (needs.length) groups.set('needs', needs)
    for (const k of ['dm', 'channel', 'friend', 'space'] as const) {
      const rest = pool.filter((i) => SECTION_OF[i.kind] === k && !needs.includes(i))
      if (rest.length) groups.set(k, rest)
    }
    return [...groups].map(([key, list]) => ({ key, items: list.slice(0, CAP[key]) }))
  }
  pool
    .map((i) => ({ i, score: Math.max(fuzzyScore(q, i.label) ?? -Infinity, (fuzzyScore(q, i.sub ?? '') ?? -Infinity) - 200) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score || Number(b.i.unread) - Number(a.i.unread))
    .slice(0, 30)
    .forEach(({ i }) => push(SECTION_OF[i.kind], i))
  return [...groups].map(([key, list]) => ({ key, items: list }))
}

/** The letters that matched, in weight 590 + primary text (why "des" found "Diego Alves"). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = FILTER[query[0] ?? ''] ? query.slice(1) : query
  const ranges = matchRanges(q, text)
  if (!ranges.length) return <>{text}</>
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) out.push(text.slice(at, a))
    out.push(
      <mark key={a} className={s.hit}>
        {text.slice(a, b)}
      </mark>,
    )
    at = b
  }
  out.push(text.slice(at))
  return <>{out}</>
}

export function QuickSwitcher() {
  const open = useUi((st) => st.switcherOpen)
  return createPortal(<AnimatePresence>{open && <Panel />}</AnimatePresence>, document.body)
}

function Panel() {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const channels = useData((st) => st.channels)
  const relationships = useData((st) => st.relationships)
  const spaces = useData((st) => st.spaces)
  const readStates = useData((st) => st.readStates)
  const all = useMemo(() => collect(useData.getState()), [channels, relationships, spaces, readStates])
  const sections = useMemo(() => rank(all, q), [all, q])
  const results = useMemo(() => sections.flatMap((x) => x.items), [sections])
  const close = () => useUi.getState().setSwitcher(false)

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => {
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (i: Item | undefined) => {
    if (!i) return
    close()
    i.run()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      setActive((a) => (results.length ? (a + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className={s.root}>
      <motion.div className={s.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.15 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onPointerDown={close} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t.label}
        className={s.panel}
        initial={{ opacity: 0, scale: 0.98, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: EASE_OUT_QUART } }}
        exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.12, ease: EASE_IN } }}
        onKeyDown={onKeyDown}
      >
        <div className={s.inputRow}>
          <Icon icon={Search} size={18} />
          <input
            ref={input}
            className={s.input}
            value={q}
            placeholder={t.placeholder}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="switcher-list"
            aria-activedescendant={results[active] ? `switcher-${results[active].id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
        </div>
        <div ref={listRef} id="switcher-list" role="listbox" aria-label={t.label} className={s.list}>
          {results.length === 0 ? (
            <p className={s.empty}>{t.empty}</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.key} role="group" aria-labelledby={`switcher-sec-${sec.key}`}>
                <div id={`switcher-sec-${sec.key}`} className={s.sectionHead} role="presentation">
                  {t.sections[sec.key]}
                </div>
                {sec.items.map((i) => {
                  const idx = results.indexOf(i)
                  return (
                    <div
                      key={i.id}
                      id={`switcher-${i.id}`}
                      role="option"
                      aria-selected={idx === active}
                      data-index={idx}
                      className={s.item}
                      onPointerMove={() => idx !== active && setActive(idx)}
                      onClick={() => choose(i)}
                    >
                      <span className={s.itemIcon}>{i.icon}</span>
                      <span className={`${s.itemLabel} ${i.unread ? s.unread : ''}`}>
                        <Highlight text={i.label} query={q} />
                      </span>
                      {i.sub && <span className={s.itemSub}>{i.sub}</span>}
                      <Badge count={i.mentions} mention />
                      {idx === active && <Icon icon={CornerDownLeft} size={14} className={s.enter} />}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <footer className={s.footer}>
          <span>
            <Kbd>↑ ↓</Kbd> {t.hint.nav}
          </span>
          <span>
            <Kbd>Enter</Kbd> {t.hint.open}
          </span>
          <span>
            <Kbd>Esc</Kbd> {t.hint.close}
          </span>
          <span className={s.filters}>{t.hint.filters}</span>
        </footer>
      </motion.div>
    </div>
  )
}
