import '@/styles/base.css'
import { useEffect, useReducer, useRef, useState } from 'react'
import type { AvatarSize } from '@/ui/Avatar'
import { Cosmetic, DecoratedAvatar, demoLevel, Nameplate, ProfileCard, SpeakingSample, StreamSample, type ProfileUser } from './Cosmetics'
import { replayAll, stats } from './engine'
import { HORA_AZUL, type CosmeticId } from './hora-azul'
import { COSMETICS, SLOTS, type Look, type Slot } from './look'
import { AppIcon } from './render/AppIcon'
import { AuraGlyph, EMOTES, EMOTE_LABEL, ReactionGlyph, ReactionLayer, showReaction } from './render/Voice'
import { t } from './strings'
import s from './gallery.module.css'

/*
 * Dev-only showcase (unpackaged builds): index.html#cosmetics-gallery. Every Hora Azul item at its real sizes,
 * moving and still; `/sheet` = the contact sheet; `/bench` (`/bench-off` = same page without cosmetics) = the
 * perf scene of scripts/cosmetics-perf.mjs: a 50-member list and 8 speaking call tiles.
 */

const PEOPLE: ProfileUser[] = [
  { id: 'u-marina', displayName: 'Marina Duarte', username: 'marina', avatarUrl: null, bio: 'Hora azul é quando a call começa.' },
  { id: 'u-caio', displayName: 'Caio Torres', username: 'caio', avatarUrl: null, accentColor: '#595e93' },
  { id: 'u-bia', displayName: 'Bia Lins', username: 'bia', avatarUrl: null, accentColor: '#6f568a' },
  { id: 'u-rafa', displayName: 'Rafa Moreira', username: 'rafa', avatarUrl: null },
]
const me = PEOPLE[0]!
const ids = (slot: Slot) => (Object.keys(HORA_AZUL) as CosmeticId[]).filter((id) => COSMETICS[id] === slot)
const SIZES: AvatarSize[] = [32, 40, 56, 80, 96]

export function CosmeticsGallery() {
  const mode = location.hash.split('/')[1] ?? ''
  // bench:list / bench:tiles = cosmetics on one half of the scene only (to attribute a cost).
  if (mode.startsWith('bench')) return <Bench off={mode === 'bench-off'} only={mode.split(':')[1]} />
  if (mode === 'sheet') return <Sheet />
  return <Showcase />
}

function useReduced(): [boolean, () => void] {
  const [on, toggle] = useReducer((v: boolean) => !v, false)
  useEffect(() => void document.documentElement.classList.toggle('reduce-motion', on), [on])
  return [on, toggle]
}

function Showcase() {
  const [reduced, toggleReduced] = useReduced()
  const [round, replay] = useReducer((n: number) => n + 1, 0)
  return (
    <div className={s.page} data-testid="cosmetics-gallery">
      <header className={s.head}>
        <div>
          <p className={s.eyebrow}>Coleção 01</p>
          <h1 className={s.title}>Hora Azul</h1>
          <p className={s.lede}>28 itens · luz do alto à esquerda · um gesto, depois repouso. ★ = herói.</p>
        </div>
        <div className={s.tools}>
          <button type="button" className={s.btn} onClick={replay} data-replay>
            Repetir tudo
          </button>
          <button type="button" className={s.btn} aria-pressed={reduced} onClick={toggleReduced}>
            Movimento reduzido
          </button>
        </div>
      </header>
      {SLOTS.map((slot) => (
        <section key={slot} className={s.shelf}>
          <h2 className={s.shelfTitle}>{t.shop.slots[slot]}</h2>
          <div className={s.items}>
            {ids(slot).map((id) => (
              <Item key={`${id}:${round}`} id={id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Item({ id }: { id: CosmeticId }) {
  const m = HORA_AZUL[id]
  const [round, replay] = useReducer((n: number) => n + 1, 0)
  return (
    <article className={`${s.item} ${'hero' in m && m.hero ? s.hero : ''}`} data-item={id}>
      <div className={s.meta}>
        <span className={s.code}>{m.code}</span>
        <h3 className={s.name}>
          {m.name}
          {'hero' in m && m.hero && <span className={s.star}> ★</span>}
        </h3>
        <span className={s.tier}>
          {m.tier} · {'plus' in m && m.plus ? 'Plus' : `R$ ${(m.brl / 100).toFixed(2).replace('.', ',')}`}
        </span>
        {m.ms > 0 && (
          <button type="button" className={s.mini} onClick={replay}>
            Repetir
          </button>
        )}
      </div>
      <div className={s.stage} data-shot key={round}>
        <Samples id={id} />
      </div>
    </article>
  )
}

function Samples({ id }: { id: CosmeticId }) {
  const slot = COSMETICS[id]
  if (slot === 'decoration')
    return (
      <div className={s.row}>
        {SIZES.map((size) => (
          <span key={size} className={s.sized}>
            <DecoratedAvatar user={me} size={size} decoration={id} decorative motion="play" presence="online" />
            <span className={s.px}>{size}</span>
          </span>
        ))}
      </div>
    )
  if (slot === 'nameplate')
    return (
      <div className={s.col}>
        <span className={s.cardName}>
          <Nameplate id={id} play>
            {me.displayName}
          </Nameplate>
        </span>
        <MemberRow user={PEOPLE[1]!} look={{ nameplate: id, decoration: 'deco_ha_halo_vidro' }} />
      </div>
    )
  if (slot === 'theme' || slot === 'effect')
    return (
      <div className={s.popover}>
        <ProfileCard user={me} look={{ [slot]: id, ...(slot === 'theme' ? { decoration: 'deco_ha_halo_vidro', nameplate: 'nameplate_ha_crepusculo' } : {}) }} />
      </div>
    )
  if (slot === 'aura')
    return (
      <div className={s.row}>
        <SpeakingSample user={me} size={96} aura={id} level={demoLevel()}>
          <span className={s.pill}>
            <AuraGlyph id={id} />
            {me.displayName}
          </span>
        </SpeakingSample>
        <SpeakingSample user={PEOPLE[2]!} size={40} aura={id} level={demoLevel(1.3)} className={s.strip} />
      </div>
    )
  if (slot === 'frame') return <StreamSample id={id} width={420} />
  if (slot === 'reactions') return <Reactions />
  if (slot === 'icon')
    return (
      <div className={s.row}>
        {[96, 48, 32, 16].map((size) => (
          <span key={size} className={s.sized}>
            <AppIcon id={id} size={size} />
            <span className={s.px}>{size}</span>
          </span>
        ))}
      </div>
    )
  return <Cosmetic id={id} />
}

function MemberRow({ user, look }: { user: ProfileUser; look: Look }) {
  return (
    <span className={s.member} data-cosmetic-hover>
      <DecoratedAvatar user={user} size={32} decoration={look.decoration} presence="online" />
      <span className={s.memberName}>
        <Nameplate id={look.nameplate} row>
          {user.displayName}
        </Nameplate>
      </span>
    </span>
  )
}

function Reactions() {
  const [n, setN] = useState(0)
  const send = () => {
    showReaction(me.id, EMOTES[n % EMOTES.length]!)
    setN(n + 1)
  }
  return (
    <div className={s.col}>
      <div className={s.row}>
        {EMOTES.map((e) => (
          <span key={e} className={s.sized} title={EMOTE_LABEL[e]}>
            <ReactionGlyph emote={e} size={64} />
          </span>
        ))}
      </div>
      <button type="button" className={s.tileMock} onClick={send} data-react>
        <DecoratedAvatar user={me} size={56} decorative />
        <ReactionLayer userId={me.id} />
        <span className={s.px}>clique para reagir</span>
      </button>
    </div>
  )
}

/** Contact sheet: every item at rest, one cell each (scripts/cosmetics-shots.mjs). */
function Sheet() {
  return (
    <div className={s.sheet} data-testid="cosmetics-sheet">
      {(Object.keys(HORA_AZUL) as CosmeticId[]).map((id) => (
        <figure key={id} className={s.cell} data-item={id}>
          <div className={s.cellArt}>
            <SheetArt id={id} />
          </div>
          <figcaption>
            <span className={s.code}>{HORA_AZUL[id].code}</span> {HORA_AZUL[id].name}
            {'hero' in HORA_AZUL[id] && HORA_AZUL[id].hero ? ' ★' : ''}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
function SheetArt({ id }: { id: CosmeticId }) {
  const slot = COSMETICS[id]
  if (slot === 'decoration') return <DecoratedAvatar user={me} size={80} decoration={id} decorative motion="rest" presence="online" />
  if (slot === 'nameplate') return <Cosmetic id={id} />
  if (slot === 'theme' || slot === 'effect')
    return (
      <div className={s.sheetCard}>
        <ProfileCard user={me} look={{ [slot]: id }} motion="rest" pose />
      </div>
    )
  if (slot === 'aura')
    return (
      <SpeakingSample user={me} size={56} aura={id}>
        <span className={s.pill}>
          <AuraGlyph id={id} />
          {me.displayName}
        </span>
      </SpeakingSample>
    )
  if (slot === 'frame') return <StreamSample id={id} width={200} motion="rest" />
  if (slot === 'reactions')
    return (
      <div className={s.row}>
        {EMOTES.slice(0, 4).map((e) => (
          <ReactionGlyph key={e} emote={e} size={36} />
        ))}
      </div>
    )
  if (slot === 'icon') return <AppIcon id={id} size={72} />
  return <Cosmetic id={id} />
}

// ── Perf bench ────────────────────────────────────────────────

const DECOS = ids('decoration').filter((id) => HORA_AZUL[id].ms > 0)
const PLATES = ids('nameplate')
const AURAS = ids('aura')

declare global {
  interface Window {
    /** Read by scripts/cosmetics-perf.mjs: frames drawn, frame intervals (ms) since the last read, replays started. */
    __bench?: { frames: number; intervals: number[]; replays: number; cosmetics: boolean; stats: typeof stats }
  }
}

/** 50 members + 8 speaking tiles, everyone wearing moving items; replays every gesture every 2.5 s (capped). */
/** `only`: list | tiles | decos | frame | <aura id> — cosmetics on that part of the scene only (cost attribution). */
function Bench({ off: none, only }: { off: boolean; only?: string }) {
  const off = none || (!!only && only !== 'list')
  const part = (p: string) => !none && (!only || only === p || (only === 'tiles' && p !== 'list'))
  const tile = { aura: (i: number) => (only?.startsWith('aura_') ? (only as CosmeticId) : part('auras') ? AURAS[i % AURAS.length] : undefined), deco: part('decos'), frame: part('frame') }
  const frames = useRef(0)
  useEffect(() => {
    window.__bench = { frames: 0, intervals: [], replays: 0, cosmetics: !none, stats }
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      const b = window.__bench!
      b.frames = ++frames.current
      if (last) b.intervals.push(now - last)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const id = none ? 0 : window.setInterval(() => (window.__bench!.replays += replayAll()), 2500)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [none])
  const members = Array.from({ length: 50 }, (_, i) => ({
    user: { id: `m-${i}`, displayName: `Pessoa ${String(i + 1).padStart(2, '0')}`, username: `p${i}`, avatarUrl: null },
    look: off ? {} : { decoration: DECOS[i % DECOS.length], nameplate: PLATES[i % PLATES.length] },
  }))
  return (
    <div className={s.bench} data-testid="cosmetics-bench">
      <aside className={s.benchList}>
        {members.map((m) => (
          <MemberRow key={m.user.id} user={m.user} look={m.look} />
        ))}
      </aside>
      <main className={s.benchStage}>
        <div className={s.benchTiles}>
          {Array.from({ length: 8 }, (_, i) => (
            <BenchTile key={i} i={i} aura={tile.aura(i)} decoration={tile.deco ? DECOS[i % DECOS.length] : undefined} />
          ))}
        </div>
        <div className={s.benchStream}>{tile.frame ? <StreamSample id="frame_ha_cinema" width={560} /> : <span className={s.benchStreamOff} />}</div>
      </main>
    </div>
  )
}

function BenchTile({ i, aura, decoration }: { i: number; aura?: CosmeticId; decoration?: CosmeticId }) {
  const user: ProfileUser = { id: `t-${i}`, displayName: `Tile ${i + 1}`, username: `t${i}`, avatarUrl: null }
  return (
    <SpeakingSample user={user} size={80} aura={aura} decoration={decoration} level={demoLevel(i * 0.77)} className={s.benchTile}>
      <span className={s.pill}>
        <AuraGlyph id={aura} />
        {user.displayName}
      </span>
    </SpeakingSample>
  )
}
