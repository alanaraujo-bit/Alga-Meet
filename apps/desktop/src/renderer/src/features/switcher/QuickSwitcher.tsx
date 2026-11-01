import { CornerDownLeft, Hash, LayoutGrid, Search, Volume2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { errorText } from '@/lib/errors'
import { fuzzyScore } from '@/lib/fuzzy'
import { openDm } from '@/store/actions'
import { isUnread, useData, type DataState } from '@/store/data'
import { channelTitle, dmPeers, mentionCount, presenceOf } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Badge, Icon, Kbd, toast } from '@/ui'
import { initials } from '@/ui/Avatar'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import s from './switcher.module.css'

const t = {
  label: 'Ir para',
  placeholder: 'Para onde vamos? Canais, conversas, amigos, espaços',
  empty: 'Nada encontrado. Tente outro nome.',
  hint: { nav: 'navegar', open: 'abrir', close: 'fechar', filters: '# canais · @ pessoas · * espaços' },
  kinds: { channel: 'Canal', voice: 'Voz', dm: 'Mensagem direta', friend: 'Amigo', space: 'Espaço' },
}

type Kind = keyof typeof t.kinds
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
          (e: unknown) => toast.error(errorText(e)),
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
      icon: <span className={s.spaceIcon}>{initials(sp.name)}</span>,
      unread: false,
      mentions: 0,
      run: () => ui.go({ kind: 'space', spaceId: id, channelId: ui.lastChannelBySpace[id] ?? null }),
    })
  }
  return items
}

const FILTER: Record<string, Kind[]> = { '#': ['channel', 'voice'], '@': ['dm', 'friend'], '*': ['space'] }

export function rank(items: Item[], raw: string): Item[] {
  const f = FILTER[raw[0] ?? '']
  const q = f ? raw.slice(1) : raw
  const pool = f ? items.filter((i) => f.includes(i.kind)) : items
  if (!q.trim()) {
    // No query: what needs you first (mentions, unread), then DMs, channels, spaces.
    const order: Kind[] = ['dm', 'channel', 'voice', 'friend', 'space']
    return [...pool].sort((a, b) => b.mentions - a.mentions || Number(b.unread) - Number(a.unread) || order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 12)
  }
  return pool
    .map((i) => ({ i, score: Math.max(fuzzyScore(q, i.label) ?? -Infinity, (fuzzyScore(q, i.sub ?? '') ?? -Infinity) - 200) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score || Number(b.i.unread) - Number(a.i.unread))
    .slice(0, 30)
    .map((x) => x.i)
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
  const results = useMemo(() => rank(all, q), [all, q])
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
            results.map((i, idx) => (
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
                <span className={`${s.itemLabel} ${i.unread ? s.unread : ''}`}>{i.label}</span>
                {i.sub && <span className={s.itemSub}>{i.sub}</span>}
                <Badge count={i.mentions} mention />
                {idx === active && <Icon icon={CornerDownLeft} size={14} className={s.enter} />}
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
