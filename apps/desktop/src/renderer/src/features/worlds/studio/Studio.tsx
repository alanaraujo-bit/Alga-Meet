// The Ateliê screen: the person's own room, alone, with the tools to arrange it, the figure they wear in every world,
// and the store of both. A lazy chunk with its own 3D engine; what it saves goes through the two REST routes and, when
// the room is open in a call right now, the people in it see the change as it is saved.
import {
  ECO_ACCENTS, WORLD_BODIES, WORLD_FABRICS, WORLD_ITEM_CATEGORIES, WORLD_ROOM_ACCESS, WORLD_ROOM_MAX_ITEMS, WORLD_ROOM_NAME_MAX, WORLD_SHELLS,
  avatarProblem, defaultWorldAvatar, spawnPose, worldEntries, worldItem,
  type WorldAvatar, type WorldEntry, type WorldItemCategory, type WorldPlacedItem, type WorldPose, type WorldRoom, type WorldRoomAccess, type WorldRoomFinish,
} from '@alga/shared'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ApiRequestError } from '@/lib/api'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Button, Icon, IconButton, Modal, SegmentedControl, Tabs, TextField, toast, Tooltip } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { Check, Couch, Lock, RefreshCw, RotateCcw, Sparkle, Trash2, X } from '@/ui/icons'
import { money } from '../../billing/look'
import { loadBilling, startCheckout, useBilling } from '../../billing/store'
import { openSettings } from '../../settings/store'
import { AssetPack, PackError, resolveAssetsUrl } from '../assets/pack'
import type { RoomEditor } from '../engine/editor'
import { WorldEngine, type WorldPerson } from '../engine/World'
import { showWorld, useWorlds } from '../store'
import { t as wt } from '../strings'
import { firstMissing, useHeld, type SkuState } from './held'
import { closeStudio, getMyRoom, putAvatar, putMyRoom, useStudio, type StudioTab } from './store'
import { thumbOf } from './thumbs'
import ws from '../worlds.module.css'
import s from './studio.module.css'

const t = wt.studio

interface Draft {
  name: string
  access: WorldRoomAccess
  finish: WorldRoomFinish
  items: WorldPlacedItem[]
}
const draftOf = (r: WorldRoom): Draft => ({ name: r.name, access: r.access, finish: { ...r.finish }, items: r.items.map((i) => ({ ...i })) })
/** JSON with the keys in order: what comes back from the database has them in its own order, and that is not a change. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const sameAvatar = (a: WorldAvatar, b: WorldAvatar) => stable(a) === stable(b)

/** A small line under a choice that is not the account's: what it is and how to have it. */
function Price({ state }: { state: SkuState }) {
  if (state.kind === 'held') return null
  if (state.kind === 'plus') return <span className={s.pill}><Icon icon={Sparkle} size={12} />Plus</span>
  if (state.kind === 'buy') return <span className={s.pill}>{state.available ? money(state.product.priceBrlCents) : t.soon}</span>
  return <span className={s.pill}><Icon icon={Lock} size={12} /></span>
}

/** The button that turns a wish into a purchase, with the app's own checkout. */
function BuyButton({ state, size = 'md' }: { state: SkuState; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = useState(false)
  if (state.kind === 'held') return <span className={s.owned}><Icon icon={Check} size={14} />{t.owned}</span>
  if (state.kind === 'plus') return <Button size={size} variant="secondary" icon={Sparkle} onClick={() => openSettings('plan')}>{t.seePlus}</Button>
  if (state.kind !== 'buy' || !state.available) return <Button size={size} variant="secondary" disabled>{t.soon}</Button>
  return (
    <Button
      size={size}
      variant="primary"
      loading={busy}
      onClick={() => {
        setBusy(true)
        void startCheckout(state.product).catch((e: unknown) => toast.error(e instanceof ApiRequestError ? e.message : t.saveFailed)).finally(() => setBusy(false))
      }}
    >
      {t.buy(money(state.product.priceBrlCents))}
    </Button>
  )
}

function Swatch({ color, label, on, onPick, state, texture }: { color: string; label: string; on: boolean; onPick: () => void; state?: SkuState; texture?: boolean }) {
  return (
    <Tooltip content={label} side="top">
      <button type="button" className={`${s.swatch} ${on ? s.swatchOn : ''} ${texture ? s.swatchWide : ''}`} style={{ background: color }} aria-label={label} aria-pressed={on} onClick={onPick}>
        {state && state.kind !== 'held' && <span className={s.swatchLock}><Icon icon={state.kind === 'plus' ? Sparkle : Lock} size={12} /></span>}
      </button>
    </Tooltip>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={s.section}>
      <header className={s.sectionHead}>
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  )
}

export default function Studio() {
  const tab = useStudio((st) => st.tab) ?? 'room'
  const me = useData((st) => st.me)
  const assetsUrl = useSession((st) => st.worlds?.assetsUrl ?? null)
  const billing = useHeld()
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const engine = useRef<WorldEngine | null>(null)
  const editor = useRef<RoomEditor | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saved, setSaved] = useState<WorldRoom | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<WorldPlacedItem | null>(null)
  const [seat, setSeat] = useState<string | null>(null)
  const [pose, setPose] = useState<WorldPose | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [category, setCategory] = useState<WorldItemCategory>('seating')
  const [engineReady, setEngineReady] = useState(0)

  const baseAvatar = useMemo(() => (me ? me.world ?? defaultWorldAvatar(me.id, me.eco) : null), [me])
  const [avatar, setAvatar] = useState<WorldAvatar | null>(baseAvatar)
  useEffect(() => { if (!avatar && baseAvatar) setAvatar(baseAvatar) }, [avatar, baseAvatar])

  const roomDirty = !!saved && !!draft && stable(draftOf(saved)) !== stable(draft)
  const avatarDirty = !!avatar && !!baseAvatar && !sameAvatar(avatar, baseAvatar)

  // While this screen is up the call's stage is not the 3D room: one engine at a time.
  useEffect(() => {
    const was = useWorlds.getState().show
    if (was) showWorld(false)
    if (!useBilling.getState().catalog) void loadBilling().catch(() => {})
    return () => { if (was && useWorlds.getState().session) showWorld(true) }
  }, [])

  useEffect(() => {
    let dead = false
    getMyRoom().then((r) => {
      if (dead) return
      setSaved(r)
      setDraft(draftOf(r))
    }).catch(() => !dead && setPhase('error'))
    return () => { dead = true }
  }, [])

  // The engine, once the room is known.
  const ready = !!saved
  useEffect(() => {
    const el = host.current, ov = overlay.current
    if (!el || !ov || !assetsUrl || !ready) return
    let dead = false
    let created: WorldEngine | null = null
    const pack = new AssetPack(resolveAssetsUrl(assetsUrl, window.alga.config.apiUrl))
    void (async () => {
      try {
        await pack.open()
        if (dead) return
        created = new WorldEngine(el, pack, {
          quality: useWorlds.getState().quality, reducedMotion: useUi.getState().reducedMotion, overlay: ov, canvasClass: ws.canvas!, label: t.title,
          hooks: {
            onSit: (id) => !dead && setSeat(id),
            onStand: (p) => { if (!dead) { setSeat(null); setPose(p) } },
            onStatus: (st) => { if (!dead && st.phase !== 'loading') setPhase(st.phase === 'ready' ? 'ready' : 'error') },
          },
        })
        engine.current = created
        setEngineReady((n) => n + 1)
      } catch (err) {
        if (!dead) setPhase('error')
        console.warn('[worlds] studio could not start:', err instanceof PackError ? err.kind : (err as Error).message)
      }
    })()
    const ro = new ResizeObserver(() => engine.current?.resize())
    ro.observe(el)
    return () => {
      dead = true
      ro.disconnect()
      created?.dispose()
      engine.current = null
      editor.current = null
    }
  }, [assetsUrl, ready])

  // The room is rebuilt for a new finish; moving pieces around is the editor's and needs no rebuild.
  const finishKey = draft ? JSON.stringify(draft.finish) : ''
  useEffect(() => {
    const e = engine.current
    if (!e || !draft) return
    const now = e.currentLayout()
    void e.setRoom({ shell: 'loft', finish: draft.finish, items: now?.items ?? draft.items }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishKey, engineReady])

  useEffect(() => {
    const e = engine.current
    if (!e || !me || !avatar) return
    const person: WorldPerson = { userId: me.id, name: '', avatar, k: 0, pose: pose ?? spawnPose(WORLD_SHELLS.loft, 0), seat, loop: null }
    e.setPeople(me.id, [person])
  }, [me, avatar, seat, pose, engineReady])

  // Arranging is on in the room tab only; in the others the room is just a place to stand.
  useEffect(() => {
    const e = engine.current
    if (!e) return
    if (tab !== 'room') {
      editor.current = e.setEditing(null)
      setSelected(null)
      return
    }
    editor.current = e.setEditing({
      onSelect: setSelected,
      onChange: (items) => setDraft((d) => (d ? { ...d, items } : d)),
    })
    return () => { editor.current = e.setEditing(null) }
  }, [tab, engineReady])

  // The figure fills the view while it is being dressed.
  useEffect(() => {
    const e = engine.current
    if (!e || phase !== 'ready') return
    e.setFigureLight(tab === 'avatar')
    if (tab === 'avatar') {
      const p = pose ?? spawnPose(WORLD_SHELLS.loft, 0)
      e.setView(((p[2] * Math.PI) / 180), 0.05, 3.1, [p[0] / 100, 1.02, p[1] / 100])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, phase, engineReady])

  const missingInRoom = useMemo(() => {
    if (!draft) return null
    const skus = [draft.finish.floor, draft.finish.wall, draft.finish.mood, ...(draft.finish.accentWall ? [draft.finish.accentWall] : []), ...draft.items.map((i) => i.sku)]
    return firstMissing(skus, billing.held)
  }, [draft, billing.held])
  const missingInAvatar = useMemo(() => (avatar ? firstMissing([avatar.finish, avatar.outfit, avatar.head], billing.held) : null), [avatar, billing.held])

  const saveRoom = useCallback(async () => {
    if (!draft || busy) return
    if (missingInRoom) return void toast.error(t.notHeld(missingInRoom.name))
    setBusy(true)
    try {
      const r = await putMyRoom({ name: draft.name.trim() || wt.myRoom, access: draft.access, finish: draft.finish, items: draft.items })
      setSaved(r)
      setDraft(draftOf(r))
      toast.success(t.saved)
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : t.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [draft, busy, missingInRoom])

  const saveAvatar = useCallback(async (next: WorldAvatar | null) => {
    if (busy) return
    setBusy(true)
    try {
      await putAvatar(next)
      if (!next) setAvatar(null)
      toast.success(t.savedAvatar)
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : t.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [busy])

  const tryClose = useCallback(() => (roomDirty || avatarDirty ? setConfirmClose(true) : closeStudio()), [roomDirty, avatarDirty])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Esc lets go of a selected piece first; only then does it close the screen.
      if (editor.current?.selection) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      tryClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tryClose])

  const addItem = useCallback(async (sku: string) => {
    const e = engine.current, ed = editor.current
    if (!e || !ed) return
    const r = await ed.add(sku, e.focusPoint())
    if (!r.ok) toast.info(r.reason === 'too_many' ? t.full : r.reason === 'too_many_copies' ? t.copies : t.saveFailed)
  }, [])

  const setFinish = (patch: Partial<WorldRoomFinish>) => setDraft((d) => (d ? { ...d, finish: { ...d.finish, ...patch } } : d))
  const selectedDef = selected ? worldItem(selected.sku) : undefined

  const roomTab = draft && (
    <>
      <Section title={t.name}>
        <TextField ariaLabel={t.name} value={draft.name} maxLength={WORLD_ROOM_NAME_MAX} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Section>
      <Section title={t.access}>
        <SegmentedControl label={t.access} value={draft.access} onChange={(access) => setDraft({ ...draft, access })} items={WORLD_ROOM_ACCESS.map((a) => ({ value: a, label: wt.access[a] }))} />
        <p className={s.note}>{wt.accessHint[draft.access]}</p>
      </Section>
      <Section title={t.finishes}>
        <div className={s.rowLabel}>{t.floor}</div>
        <div className={s.swatches}>
          {worldEntries('floor').map((f) => <Swatch key={f.sku} texture color={FLOOR_COLOR[f.texture] ?? f.tint} label={f.name} on={draft.finish.floor === f.sku} state={billing.state(f.sku)} onPick={() => setFinish({ floor: f.sku })} />)}
        </div>
        <div className={s.rowLabel}>{t.walls}</div>
        <div className={s.swatches}>
          {worldEntries('wall').map((f) => <Swatch key={f.sku} color={WALL_COLOR[f.texture] ?? f.tint} label={f.name} on={draft.finish.wall === f.sku} state={billing.state(f.sku)} onPick={() => setFinish({ wall: f.sku })} />)}
        </div>
        <div className={s.rowLabel}>{t.accent}</div>
        <div className={s.swatches}>
          <Tooltip content={t.accentSame} side="top">
            <button type="button" className={`${s.swatch} ${s.swatchNone} ${draft.finish.accentWall === null ? s.swatchOn : ''}`} aria-label={t.accentSame} aria-pressed={draft.finish.accentWall === null} onClick={() => setFinish({ accentWall: null })} />
          </Tooltip>
          {worldEntries('wall').map((f) => <Swatch key={f.sku} color={WALL_COLOR[f.texture] ?? f.tint} label={f.name} on={draft.finish.accentWall === f.sku} state={billing.state(f.sku)} onPick={() => setFinish({ accentWall: f.sku })} />)}
        </div>
        <div className={s.rowLabel}>{t.mood}</div>
        <SegmentedControl label={t.mood} value={draft.finish.mood} onChange={(mood) => setFinish({ mood })} items={worldEntries('mood').map((m) => ({ value: m.sku, label: m.name }))} />
      </Section>
      <Section title={t.pieces} aside={<span className={s.count}>{t.count(draft.items.length, WORLD_ROOM_MAX_ITEMS)}</span>}>
        <div className={s.chips} role="tablist" aria-label={t.pieces}>
          {WORLD_ITEM_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={`${s.chip} ${category === c ? s.chipOn : ''}`} onClick={() => setCategory(c)}>{wt.categories[c]}</button>
          ))}
        </div>
        <div className={s.grid}>
          {worldEntries('item').filter((i) => i.category === category).map((i) => {
            const st = billing.state(i.sku)
            return (
              <button key={i.sku} type="button" className={s.piece} onClick={() => void addItem(i.sku)} aria-label={`${t.add}: ${i.name}`}>
                <span className={s.pieceThumb}>{thumbOf(i.sku) ? <img src={thumbOf(i.sku)} alt="" draggable={false} /> : <Icon icon={Couch} size={24} />}</span>
                <span className={s.pieceName}>{i.name}</span>
                <Price state={st} />
              </button>
            )
          })}
        </div>
        <p className={s.note}>{t.editHint}</p>
      </Section>
    </>
  )

  const patchAvatar = (patch: Partial<WorldAvatar>) => setAvatar((a) => (a ? { ...a, ...patch } : a))
  const partRow = (kind: 'avatar_finish' | 'avatar_outfit' | 'avatar_head', field: 'finish' | 'outfit' | 'head') => (
    <div className={s.chips}>
      {worldEntries(kind).map((p) => {
        const st = billing.state(p.sku)
        return (
          <button key={p.sku} type="button" aria-pressed={avatar?.[field] === p.sku} className={`${s.chip} ${avatar?.[field] === p.sku ? s.chipOn : ''}`} onClick={() => patchAvatar({ [field]: p.sku })}>
            {p.name}
            {st.kind !== 'held' && <Icon icon={st.kind === 'plus' ? Sparkle : Lock} size={12} />}
          </button>
        )
      })}
    </div>
  )
  const fabricRow = (field: 'top' | 'bottom' | 'shoes') => (
    <>
      <div className={s.rowLabel}>{t.fabrics[field]}</div>
      <div className={s.swatches}>
        {WORLD_FABRICS.map((c, i) => <Swatch key={c} color={c} label={`${t.fabrics[field]} ${i + 1}`} on={avatar?.[field] === i} onPick={() => patchAvatar({ [field]: i })} />)}
      </div>
    </>
  )
  const avatarTab = avatar && (
    <>
      <Section title={t.body}>
        <SegmentedControl label={t.body} value={avatar.body} onChange={(body) => patchAvatar({ body })} items={WORLD_BODIES.map((b) => ({ value: b, label: t.bodies[b] }))} />
      </Section>
      <Section title={t.finish}>{partRow('avatar_finish', 'finish')}</Section>
      <Section title={t.joints}>
        <div className={s.swatches}>
          {ECO_ACCENTS.map((c) => <Swatch key={c} color={c} label={c} on={avatar.accent === c} onPick={() => patchAvatar({ accent: c })} />)}
        </div>
      </Section>
      <Section title={t.outfit}>
        {partRow('avatar_outfit', 'outfit')}
        {fabricRow('top')}
        {fabricRow('bottom')}
        {fabricRow('shoes')}
      </Section>
      <Section title={t.head}>{partRow('avatar_head', 'head')}</Section>
      <Section title={t.automatic}>
        <p className={s.note}>{t.automaticHint}</p>
        <Button variant="secondary" size="sm" icon={RotateCcw} disabled={!me?.world || busy} onClick={() => void saveAvatar(null)}>{t.automatic}</Button>
      </Section>
    </>
  )

  const paid = useMemo(() => worldEntries('item').filter((e) => e.tier !== 'base'), [])
  const storeCard = (e: WorldEntry) => (
    <article key={e.sku} className={`${s.card} ${e.hero ? s.cardHero : ''}`}>
      <div className={s.cardArt}>
        {thumbOf(e.sku) ? <img src={thumbOf(e.sku)} alt="" draggable={false} /> : <span className={s.cardSwatch} style={{ background: swatchOf(e) }} />}
      </div>
      <div className={s.cardBody}>
        <span className={s.cardKind}>{t.kind[e.kind]}</span>
        <strong>{e.name}</strong>
        <BuyButton state={billing.state(e.sku)} size="sm" />
      </div>
    </article>
  )
  const storeTab = (
    <>
      <p className={s.intro}>{t.storeIntro}</p>
      <Section title={t.highlights}>
        <div className={s.cards}>{[...paid, ...worldEntries('avatar_finish'), ...worldEntries('avatar_outfit')].filter((e) => e.hero).map(storeCard)}</div>
      </Section>
      <Section title={t.forRoom}>
        <div className={s.cards}>{[...paid.filter((e) => !e.hero), ...worldEntries('floor'), ...worldEntries('wall')].filter((e) => e.tier !== 'base').map(storeCard)}</div>
      </Section>
      <Section title={t.forAvatar}>
        <div className={s.cards}>{[...worldEntries('avatar_finish'), ...worldEntries('avatar_outfit'), ...worldEntries('avatar_head')].filter((e) => e.tier !== 'base' && !e.hero).map(storeCard)}</div>
      </Section>
    </>
  )

  const problem = avatar ? avatarProblem(avatar, billing.held) : null
  const footer = tab === 'room' ? (
    missingInRoom ? (
      <div className={s.footRow}>
        <span className={s.footNote}>{t.trying(missingInRoom.name)}</span>
        <BuyButton state={billing.state(missingInRoom.sku)} />
      </div>
    ) : (
      <Button variant="primary" full loading={busy} disabled={!roomDirty} onClick={() => void saveRoom()}>{t.save}</Button>
    )
  ) : tab === 'avatar' ? (
    missingInAvatar ? (
      <div className={s.footRow}>
        <span className={s.footNote}>{t.trying(missingInAvatar.name)}</span>
        <BuyButton state={billing.state(missingInAvatar.sku)} />
      </div>
    ) : (
      <Button variant="primary" full loading={busy} disabled={!avatarDirty || !!problem} onClick={() => avatar && void saveAvatar(avatar)}>{t.saveAvatar}</Button>
    )
  ) : null

  return createPortal(
    <div className={s.root} role="dialog" aria-modal="true" aria-label={t.title}>
      <div className={s.view}>
        <div ref={host} className={ws.host} />
        <div ref={overlay} className={ws.overlay} />
        {phase !== 'ready' && (
          <div className={ws.veil} role={phase === 'error' ? 'alert' : 'status'}>
            <Eco state={phase === 'error' ? 'error' : 'connecting'} size={56} />
            <strong>{phase === 'error' ? t.loadFailed : t.loading}</strong>
            {phase === 'error' && <div className={ws.veilActions}><Button variant="primary" onClick={closeStudio}>{t.close}</Button></div>}
          </div>
        )}
        {phase === 'ready' && tab !== 'room' && <div className={s.viewHint}>{t.walkHint}</div>}
        {phase === 'ready' && tab === 'room' && selected && selectedDef && (
          <div className={s.selected} role="toolbar" aria-label={selectedDef.name}>
            <strong>{selectedDef.name}</strong>
            {selectedDef.variants && (
              <div className={s.variants} role="group" aria-label={t.selected.colour}>
                {selectedDef.variants.map((v) => (
                  <button key={v.id} type="button" className={`${s.variant} ${(selected.variant ?? selectedDef.variants![0]!.id) === v.id ? s.variantOn : ''}`} onClick={() => void editor.current?.setVariant(v.id)}>{v.name}</button>
                ))}
              </div>
            )}
            {selectedDef.place !== 'wall' && (
              <>
                <IconButton icon={RotateCcw} label={t.selected.rotateLeft} shortcut="Q" tooltipSide="top" onClick={() => editor.current?.rotate(-1)} />
                <IconButton icon={RefreshCw} label={t.selected.rotateRight} shortcut="E" tooltipSide="top" onClick={() => editor.current?.rotate(1)} />
              </>
            )}
            <IconButton icon={Trash2} label={t.selected.remove} shortcut="Del" tooltipSide="top" onClick={() => editor.current?.remove()} />
          </div>
        )}
      </div>
      <aside className={s.panel}>
        <header className={s.head}>
          <h2>{t.title}</h2>
          <IconButton icon={X} label={t.close} shortcut="Esc" onClick={tryClose} />
        </header>
        <div className={s.tabs}>
          <Tabs<StudioTab>
            label={t.title}
            value={tab}
            onChange={(v) => useStudio.setState({ tab: v })}
            items={[{ value: 'room', label: t.tabs.room }, { value: 'avatar', label: t.tabs.avatar }, { value: 'store', label: t.tabs.store }]}
          />
        </div>
        <div className={s.scroll}>
          {tab === 'room' ? roomTab : tab === 'avatar' ? avatarTab : storeTab}
        </div>
        {footer && <footer className={s.foot}>{footer}</footer>}
      </aside>
      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t.unsaved}
        footer={<><Button variant="ghost" onClick={closeStudio}>{t.discard}</Button><Button variant="primary" onClick={() => setConfirmClose(false)}>{t.keep}</Button></>}
      />
    </div>,
    document.body,
  )
}

/** A colour that stands for a finish on its swatch (the wall tints are their own colour). */
const FLOOR_COLOR: Record<string, string> = { floor_oak: '#b98a5e', floor_walnut: '#5b3d2b', floor_concrete: '#9a9995', floor_stone: '#d9d2c6' }
const WALL_COLOR: Record<string, string> = { wall_concrete: '#a9a8a4', wall_wood: '#7a563c' }
const AVATAR_COLOR: Record<string, string> = { a_bronze: '#a8743f', a_obsidiana: '#0e0e10', a_perola: '#f3ece6', o_alfaiataria: '#2b3a55', o_veludo: '#5a4a78', h_chapeu: '#2a2623', h_oculos_sol: '#101011' }
function swatchOf(e: WorldEntry): string {
  if (e.kind === 'floor') return FLOOR_COLOR[e.texture] ?? e.tint
  if (e.kind === 'wall') return WALL_COLOR[e.texture] ?? e.tint
  return AVATAR_COLOR[e.sku] ?? '#26272b'
}
