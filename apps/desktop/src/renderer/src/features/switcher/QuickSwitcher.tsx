import { MusicNotes, Megaphone, CornerDownLeft, Hash, Headphones, HeadphoneOff, Mic, MicOff, MonitorOff, MonitorUp, Phone, PhoneOff, Search, Settings2, Volume2 } from '@/ui/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fold, fuzzyScore, matchRanges } from '@/lib/fuzzy'
import { media, useMedia } from '@/media'
import { openDm } from '@/store/actions'
import { isUnread, useData, type DataState } from '@/store/data'
import { channelTitle, dmPeers, mentionCount, presenceOf } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { useSession } from '@/store/session'
import { Avatar, Badge, Icon, Kbd } from '@/ui'
import { initials } from '@/ui/Avatar'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { toastError } from '../auth/VerifyEmail'
import { loadBindings } from '../settings/hotkeys'
import { openSettings } from '../settings/store'
import { openFeedback } from '../feedback/store'
import { openCard as openMusic } from '../music/store'
import { t as musicT } from '../music/strings'
import { t as feedbackT } from '../feedback/strings'
import { inVoice, joinVoice, leaveVoice, openCall, useVoice } from '../voice/voice'
import s from './switcher.module.css'

const t = {
  label: 'Ir para',
  placeholder: 'Para onde vamos? Canais, conversas, pessoas ou uma ação',
  empty: 'Nada encontrado. Tente outro nome.',
  hint: { nav: 'navegar', open: 'abrir', run: 'fazer', close: 'fechar', filters: '# canais · @ pessoas · > ações' },
  sections: { needs: 'Precisa de você', actions: 'Ações', dm: 'Conversas', channel: 'Canais', friend: 'Pessoas', space: 'Espaços' },
  act: {
    join: (name: string) => `Entrar em ${name}`,
    call: (name: string) => `Ligar para ${name}`,
    mute: 'Silenciar microfone',
    unmute: 'Ativar microfone',
    deafen: 'Desativar áudio',
    undeafen: 'Ativar áudio',
    share: 'Compartilhar tela',
    stopShare: 'Parar transmissão',
    leave: 'Sair da chamada',
    settings: 'Abrir configurações',
    voiceSettings: 'Configurações de voz e vídeo',
  },
}

type Kind = 'channel' | 'voice' | 'dm' | 'friend' | 'space' | 'action'
export interface Item {
  id: string
  kind: Kind
  label: string
  sub?: string
  /** Other words that find it ("mudo" finds Silenciar microfone). */
  keywords?: string
  icon: ReactNode
  unread: boolean
  mentions: number
  /** Shortcut shown on the right (actions). */
  kbd?: string
  /** Contextual: offered before you type anything (the call you are in). */
  suggested?: boolean
  run: () => void
}

const hotkeyLabel = (action: string) => loadBindings().find((b) => b.action === action)?.label

/**
 * What Ctrl K can DO, not only where it goes (critique r3, sexy move 4): join a room, mute, deafen, share, leave,
 * call a friend, open settings. The call you are in is offered first; everything else appears as you type.
 */
function collectActions(d: DataState): Item[] {
  const m = useMedia.getState()
  const here = inVoice()
  const items: Item[] = []
  const action = (id: string, label: string, icon: ReactNode, run: () => void, extra: Partial<Item> = {}): Item => ({ id: `act-${id}`, kind: 'action', label, icon, unread: false, mentions: 0, run, ...extra })
  if (here) {
    const muted = m.self.muted || m.self.deafened
    items.push(action('mute', muted ? t.act.unmute : t.act.mute, <Icon icon={muted ? Mic : MicOff} size={16} />, () => void media.toggleMute(), { suggested: true, keywords: 'mudo mutar microfone silenciar', kbd: hotkeyLabel('toggleMute') }))
    items.push(action('deafen', m.self.deafened ? t.act.undeafen : t.act.deafen, <Icon icon={m.self.deafened ? Headphones : HeadphoneOff} size={16} />, () => void media.toggleDeafen(), { suggested: true, keywords: 'surdo ensurdecer fone audio', kbd: hotkeyLabel('toggleDeafen') }))
    if (m.connection.state === 'connected')
      items.push(
        m.screen.active
          ? action('share', t.act.stopShare, <Icon icon={MonitorOff} size={16} />, () => void media.stopScreenShare(), { suggested: true, keywords: 'tela transmissão parar' })
          : action('share', t.act.share, <Icon icon={MonitorUp} size={16} />, () => useVoice.setState({ picker: true }), { suggested: true, keywords: 'tela transmitir stream compartilhar' }),
      )
    items.push(action('leave', t.act.leave, <Icon icon={PhoneOff} size={16} />, leaveVoice, { suggested: true, keywords: 'desconectar sair chamada voz' }))
  }
  for (const c of Object.values(d.channels)) {
    if (c.type !== 'voice' || !c.spaceId || !d.spaces[c.spaceId] || m.connection.channelId === c.id) continue
    const people = Object.values(d.voiceStates).filter((v) => v.channelId === c.id).length
    items.push(
      action(`join-${c.id}`, t.act.join(c.name), <Icon icon={Volume2} size={16} />, () => (openCall(c.id), void joinVoice(c.id)), {
        sub: people ? `${d.spaces[c.spaceId]!.name} · ${people === 1 ? '1 pessoa' : `${people} pessoas`}` : d.spaces[c.spaceId]!.name,
        keywords: 'voz entrar',
        // The busiest room is worth offering before you type, when you are not in a call.
        suggested: !here && people > 0,
      }),
    )
  }
  for (const r of Object.values(d.relationships)) {
    if (r.type !== 'friend') continue
    items.push(
      action(`call-${r.user.id}`, t.act.call(r.user.displayName), <Icon icon={Phone} size={16} />, () =>
        void openDm([r.user.id]).then(
          (ch) => {
            useUi.getState().go({ kind: 'dm', channelId: ch.id })
            void joinVoice(ch.id)
          },
          (e: unknown) => toastError(e),
        ),
      { sub: `@${r.user.username}`, keywords: 'chamada telefonar' }),
    )
  }
  items.push(action('settings', t.act.settings, <Icon icon={Settings2} size={16} />, () => openSettings('account'), { kbd: 'Ctrl ,', keywords: 'preferências configurar opções' }))
  items.push(action('voice-settings', t.act.voiceSettings, <Icon icon={Settings2} size={16} />, () => openSettings('voice'), { keywords: 'microfone dispositivos fone câmera' }))
  if (here && useSession.getState().music) items.push(action('music', musicT.action, <Icon icon={MusicNotes} size={16} />, openMusic, { keywords: musicT.actionKeywords }))
  items.push(action('feedback', feedbackT.entry.action, <Icon icon={Megaphone} size={16} />, () => openFeedback(), { keywords: feedbackT.entry.keywords }))
  return items
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
        icon: peer ? <Avatar user={peer} size={20} presence={presenceOf(d, peer.id)} decorative /> : <Avatar user={{ id: c.id, displayName: channelTitle(d, c), avatarUrl: null }} size={20} decorative group />,
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
  return [...items, ...collectActions(d)]
}

const FILTER: Record<string, Kind[]> = { '#': ['channel', 'voice'], '@': ['dm', 'friend'], '*': ['space'], '>': ['action'] }

type SectionKey = keyof typeof t.sections
const SECTION_OF: Record<Kind, Exclude<SectionKey, 'needs'>> = { dm: 'dm', channel: 'channel', voice: 'channel', friend: 'friend', space: 'space', action: 'actions' }
/** Without a query each section shows a few; "Precisa de você" (mentions, unread) comes first. */
const CAP: Record<SectionKey, number> = { needs: 6, actions: 4, dm: 5, channel: 5, friend: 4, space: 4 }

/**
 * Results under section headers. No query: what needs you, the call you are in (its actions), then conversations,
 * channels, people, spaces. With a query: best matches first, grouped by kind in the order their best match ranks.
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
    // Actions only when they are about now (or when you asked for them with >): never a wall of verbs. In a call,
    // the call's own actions lead: that is what you opened Ctrl K for.
    const acts = pool.filter((i) => i.kind === 'action' && (f || i.suggested))
    const inCall = acts.some((i) => i.id === 'act-leave')
    if (acts.length && inCall) groups.set('actions', acts)
    if (needs.length) groups.set('needs', needs)
    if (acts.length && !inCall) groups.set('actions', acts)
    for (const k of ['dm', 'channel', 'friend', 'space'] as const) {
      const rest = pool.filter((i) => SECTION_OF[i.kind] === k && !needs.includes(i))
      if (rest.length) groups.set(k, rest)
    }
    return [...groups].map(([key, list]) => ({ key, items: f ? list : list.slice(0, CAP[key]) }))
  }
  pool
    // The secondary line and the keywords only count as whole words typed (a scattered match in "Estúdio Alga" is noise).
    .map((i) => ({ i, score: Math.max(fuzzyScore(q, i.label) ?? -Infinity, contains(i.sub, q) ? 300 : -Infinity, contains(i.keywords, q) ? 240 : -Infinity) - (i.kind === 'action' ? 40 : 0) }))
    .filter((x) => x.score > -Infinity)
    .sort((a, b) => b.score - a.score || Number(b.i.unread) - Number(a.i.unread))
    .slice(0, 30)
    .forEach(({ i }) => push(SECTION_OF[i.kind], i))
  return [...groups].map(([key, list]) => ({ key, items: list }))
}

const contains = (text: string | undefined, q: string) => !!text && fold(text).includes(fold(q.trim()))

/** The letters that matched in 590 + primary text, the rest stays secondary (why "des" found "Diego Alves"). */
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

const WIDTH = 600

/**
 * Where the palette grows from: the title bar's search field (data-switcher-anchor), same place, 420 → 600 wide in
 * 180 ms out-quart, and back into it on close. No anchor (the connection chip took its place): centered as before.
 */
function useAnchor() {
  const [a] = useState(() => {
    const r = document.querySelector<HTMLElement>('[data-switcher-anchor]')?.getBoundingClientRect()
    if (!r || r.width === 0) return null
    const half = Math.min(WIDTH, window.innerWidth - 48) / 2
    return { top: r.top, cx: Math.min(Math.max(r.left + r.width / 2, half + 24), window.innerWidth - half - 24), w: r.width, h: r.height }
  })
  return a
}

function Panel() {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const anchor = useAnchor()
  const channels = useData((st) => st.channels)
  const relationships = useData((st) => st.relationships)
  const spaces = useData((st) => st.spaces)
  const readStates = useData((st) => st.readStates)
  const voiceStates = useData((st) => st.voiceStates)
  const call = useMedia((st) => `${st.connection.state}:${st.connection.channelId}:${st.self.muted}:${st.self.deafened}:${st.screen.active}`)
  const all = useMemo(() => collect(useData.getState()), [channels, relationships, spaces, readStates, voiceStates, call])
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
    // The first result keeps its section title in view (the panel is still growing when this first runs).
    if (active === 0) listRef.current?.scrollTo({ top: 0 })
    else listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, q])

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

  const grow = anchor
    ? {
        style: { position: 'absolute' as const, top: anchor.top, left: anchor.cx, x: '-50%', transformOrigin: '50% 0' },
        initial: { width: anchor.w, height: anchor.h, borderRadius: 6 },
        animate: { width: Math.min(WIDTH, window.innerWidth - 48), height: 'auto' as const, borderRadius: 16, transition: { duration: 0.18, ease: EASE_OUT_QUART } },
        exit: { width: anchor.w, height: anchor.h, borderRadius: 6, opacity: 0, transition: { duration: 0.14, ease: EASE_IN } },
      }
    : {
        initial: { opacity: 0, scale: 0.98, y: -6 },
        animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: EASE_OUT_QUART } },
        exit: { opacity: 0, scale: 0.99, transition: { duration: 0.12, ease: EASE_IN } },
      }
  const active_ = results[active]

  return (
    <div className={`${s.root} ${anchor ? s.anchored : ''}`}>
      <motion.div className={s.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.15 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onPointerDown={close} />
      <motion.div role="dialog" aria-modal="true" aria-label={t.label} className={s.panel} {...grow} onKeyDown={onKeyDown}>
        <div className={s.inputRow}>
          <Icon icon={Search} size={16} />
          <input
            ref={input}
            className={s.input}
            value={q}
            placeholder={t.placeholder}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="switcher-list"
            aria-activedescendant={active_ ? `switcher-${active_.id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
        </div>
        {/* The list arrives just after the field has grown: the field is the object, the results are its content. */}
        <motion.div className={s.body} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.16, delay: anchor ? 0.07 : 0, ease: EASE_OUT_QUART } }} exit={{ opacity: 0, transition: { duration: 0.06 } }}>
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
                        <span className={s.itemEnd}>
                          {i.kbd && <Kbd>{i.kbd}</Kbd>}
                          {idx === active && <Icon icon={CornerDownLeft} size={14} className={s.enter} />}
                        </span>
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
              <Kbd>Enter</Kbd> {active_?.kind === 'action' ? t.hint.run : t.hint.open}
            </span>
            <span>
              <Kbd>Esc</Kbd> {t.hint.close}
            </span>
            <span className={s.filters}>{t.hint.filters}</span>
          </footer>
        </motion.div>
      </motion.div>
    </div>
  )
}
