/*
 * Dev-only bench for Alga Worlds (unpackaged builds): the room, its light and its figures without a call or an account.
 * See vite.worlds-lab.config.ts for how to open it and the query parameters. `window.__world` is the engine.
 */
import { useEffect, useRef, useState } from 'react'
import '@/styles/base.css'
import {
  DOMINO_BOT, ECO_ACCENTS, LOUNGE_ROOM, STARTER_ROOM, WORLD_GESTURES, WORLD_SHELLS, cueSpot, defaultWorldAvatar, dominoAuto, dominoBotSeat, dominoDeal,
  dominoPlay, dominoSit, dominoStand, dominoStep, dominoView, newDomino, newPool, poolJoin, poolLeave, poolRack, poolShoot, roomSeats, spawnPose,
  worldEntries, worldItem,
  type DominoState, type DominoView, type PoolState, type WorldAvatar, type WorldRoomLayout,
} from '@alga/shared'
import { AssetPack } from './assets/pack'
import { WorldEngine, type WorldPerson } from './engine/World'
import type { QualityPref } from './engine/quality'
import { DominoHud } from './domino/DominoHud'
import type { DominoUi } from './domino/DominoRoom'
import { PoolHud } from './pool/PoolHud'
import type { PoolUi } from './pool/PoolRoom'
import s from './worlds.module.css'

const NAMES = ['Ana', 'Bruno', 'Carol', 'Davi', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Íris', 'João', 'Lia', 'Marcos', 'Nina', 'Otto', 'Paula']
const VIEWS: Record<string, [number, number, number, [number, number, number]?]> = {
  // yaw, pitch, distance, target
  wide: [Math.PI * 1.22, 0.3, 7.6, [0.4, 1.2, 0.2]],
  pool: [Math.PI * 0.2, 0.42, 4.6, [-1.1, 0.8, -1.3]],
  cloth: [Math.PI * 0.5, 0.5, 1.9, [-1.1, 0.83, -2.1]],
  domino: [Math.PI * 0.12, 0.5, 3.4, [2.1, 0.8, -2.7]],
  sofa: [Math.PI * 1.5, 0.16, 3.4, [1.6, 1.0, 0.4]],
  window: [Math.PI * 1.02, 0.14, 6.5, [0, 1.3, 0.6]],
  table: [Math.PI * 0.72, 0.3, 4.2, [-3.0, 1.0, 1.6]],
  figure: [Math.PI * 0.95, 0.08, 2.6, [-3.6, 1.05, -2.9]],
  top: [Math.PI * 1.25, 1.2, 8, [0, 0.5, 0]],
}

function fakeAvatar(i: number): WorldAvatar {
  const base = defaultWorldAvatar(`lab-person-${i}`)
  const finishes = worldEntries('avatar_finish'), outfits = worldEntries('avatar_outfit'), heads = worldEntries('avatar_head')
  return {
    ...base,
    body: i % 2 === 0 ? 'a' : 'b',
    finish: finishes[i % finishes.length]!.sku,
    outfit: outfits[(i * 3 + 1) % outfits.length]!.sku,
    head: heads[(i * 2) % heads.length]!.sku,
    accent: ECO_ACCENTS[(i * 5) % ECO_ACCENTS.length]!,
    top: (i * 7 + 1) % 16, bottom: (i * 3 + 4) % 6, shoes: i % 2 ? 5 : 0,
  }
}

/** A moving test card standing in for a shared screen. */
function testVideo(): HTMLVideoElement {
  const c = document.createElement('canvas')
  c.width = 1280
  c.height = 720
  const ctx = c.getContext('2d')!
  let t = 0
  const draw = () => {
    t += 1
    const g = ctx.createLinearGradient(0, 0, c.width, c.height)
    g.addColorStop(0, `hsl(${(t * 0.4) % 360} 55% 22%)`)
    g.addColorStop(1, `hsl(${(t * 0.4 + 80) % 360} 60% 38%)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.font = '600 64px Inter Variable, sans-serif'
    ctx.fillText('Tela compartilhada', 80, 150)
    ctx.font = '400 30px Inter Variable, sans-serif'
    ctx.fillText(`quadro ${t}`, 80, 210)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(80 + ((t * 6) % 1000), 520, 120, 80)
  }
  draw()
  const timer = setInterval(draw, 66)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.srcObject = c.captureStream(15)
  void v.play().catch(() => {})
  ;(v as unknown as { __stop: () => void }).__stop = () => clearInterval(timer)
  return v
}

export function WorldsLab() {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const engine = useRef<WorldEngine | null>(null)
  const [stat, setStat] = useState('…')
  const [error, setError] = useState<string | null>(null)
  const [poolUi, setPoolUi] = useState<PoolUi | null>(null)
  const [poolShown, setPoolShown] = useState<Record<string, PoolState>>({})
  const rack = useRef<(table: string) => void>(() => {})
  const [dominoUi, setDominoUi] = useState<DominoUi | null>(null)
  const [dominoShown, setDominoShown] = useState<{ view: DominoView | null; at: number }>({ view: null, at: 0 })
  const dominoDo = useRef<{ start(): void; bot(add: boolean): void }>({ start: () => {}, bot: () => {} })
  const q = new URLSearchParams(location.search)
  const [roomId, setRoomId] = useState(q.get('room') ?? 'starter')
  const [mood, setMood] = useState(q.get('mood') ?? 'hora_azul')
  const [quality, setQuality] = useState<QualityPref>((q.get('quality') as QualityPref | null) ?? 'auto')
  const peopleN = Number(q.get('people') ?? 5)

  useEffect(() => {
    const el = host.current!, ov = overlay.current!
    const pack = new AssetPack(q.get('pack') ?? '/__worlds')
    if (q.get('thumbs')) {
      // Item pictures for the Ateliê (scripts/worlds-thumbs.mjs calls this and writes the files).
      ;(window as unknown as { __thumbs: (size?: number, only?: string[]) => Promise<Record<string, string>> }).__thumbs = async (size, only) => {
        await pack.open()
        return (await import('./dev/thumbs')).renderThumbs(pack, size, only)
      }
      return
    }
    let world: WorldEngine | null = null
    let dead = false
    const levels = new Map<string, number>()
    const talk = setInterval(() => {
      // Somebody is always saying something.
      const i = Math.floor(Math.random() * (peopleN + 1))
      levels.clear()
      levels.set(i === 0 ? 'me' : `p${i}`, 0.5)
    }, 2600)
    const video = q.get('tv') === 'off' ? null : testVideo()
    // Pool: the lab is its own server (the same shared rules), so a table can be played here. ?pool=match seats a
    // second player, who shoots by itself at whatever ball it likes.
    let pools: PoolState[] = []
    const seed = (): number => Math.floor(Math.random() * 2 ** 32)
    const tableOf = (table: string): PoolState => pools.find((p) => p.table === table) ?? newPool(table, seed())
    // The scoreboard waits for the balls of a shot to stop, like the app's.
    const show = (): void => setPoolShown(Object.fromEntries(pools.map((p) => [p.table, p])))
    const put = (table: string, next: PoolState | null): void => {
      const shot = !!next?.last && pools.find((p) => p.table === table)?.shot === next.shot - 1
      pools = [...pools.filter((p) => p.table !== table), ...(next ? [next] : [])]
      if (!shot) show()
      world?.setPools(pools)
      ;(window as unknown as { __pools: PoolState[] }).__pools = pools
    }
    const bot = (table: string): void => {
      const st = tableOf(table)
      if (dead || st.phase !== 'play' || st.players[st.turn] !== 'p1') return
      const c = st.balls[0] ?? cueSpot(st.balls)
      const targets = st.balls.flatMap((b, i) => (b && i > 0 ? [b] : []))
      const t = targets[Math.floor(Math.random() * targets.length)] ?? [0, 0]
      const r = poolShoot(st, 'p1', st.shot, { dx: t[0] - c[0] + (Math.random() - 0.5) * 0.03, dy: t[1] - c[1] + (Math.random() - 0.5) * 0.03, v: st.breaking ? 6.5 : 1.2 + Math.random() * 2.5, a: 0, b: 0, e: 0.05 }, st.hand ? [c[0], c[1]] : undefined)
      if ('state' in r) put(table, r.state)
    }
    // Dominoes: the lab is its own server here too (the same shared rules and the same pace, times ?pace). Sitting on a
    // chair of the table joins; ?domino=N puts N bots on the other chairs; ?sit=dom:0 starts sitting there.
    let dom: DominoState | null = null
    let domTimer: ReturnType<typeof setTimeout> | undefined
    let domRev = 0
    const pace = Number(q.get('pace') ?? 1)
    const domSeen = (): DominoView | null => {
      if (!dom) return null
      const auto = dominoAuto(dom)
      return { ...dominoView(dom, 'me'), auto: auto && { kind: auto.kind, ms: auto.ms * pace } }
    }
    const domPut = (next: DominoState | 'empty' | null): void => {
      if (next === null || dead) return
      clearTimeout(domTimer)
      dom = next === 'empty' ? null : next
      const auto = dom ? dominoAuto(dom) : null
      if (auto) domTimer = setTimeout(() => dom && domPut(dominoStep(dom, seed())), auto.ms * pace)
      const view = domSeen()
      setDominoShown({ view, at: performance.now() })
      world?.setDominos(view ? [view] : [], domRev)
      ;(window as unknown as { __domino: DominoState | null }).__domino = dom
    }
    /** Who sits where is who is at the table, as on the server. */
    const domSync = (seat: string | null, table: string | undefined): void => {
      const at = table && seat?.startsWith(table + ':') ? Number(seat.slice(table.length + 1)) : -1
      const was = dom ? dom.seats.indexOf('me') : -1
      if (at === was) return
      let st: DominoState | 'empty' = dom ?? newDomino(table ?? 'dom')
      if (was >= 0) st = dominoStand(st, was) ?? st
      if (at >= 0) {
        st = dominoSit(st === 'empty' ? newDomino(table!) : st, at, 'me') ?? st
        for (let i = 0; st !== 'empty' && st.phase === 'lobby' && i < Number(q.get('domino') ?? 0); i++) {
          const chair = dominoBotSeat(st, at, true)
          if (chair !== null) st = dominoSit(st, chair, DOMINO_BOT) ?? st
        }
      }
      domPut(st)
    }
    void (async () => {
      try {
        await pack.open()
        if (dead) return
        world = new WorldEngine(el, pack, {
          quality, reducedMotion: false, overlay: ov, canvasClass: s.canvas!, label: 'lab',
          hooks: {
            voice: (id) => (levels.get(id) ?? 0) * (0.6 + 0.4 * Math.sin(performance.now() / 90)),
            onStatus: (st) => { if (st.phase === 'error') setError(st.message) },
            onSit: (seat) => { me.seat = seat; push(); domSync(seat, domTable) },
            onStand: (pose) => { me.seat = null; me.pose = pose; push(); domSync(null, domTable) },
            domino: {
              onPlay: (_table, n, tile, end) => {
                const r = dom ? dominoPlay(dom, dom.seats.indexOf('me'), tile, end, n) : { error: 'not_playing' }
                if ('state' in r) return domPut(r.state)
                console.warn('[lab] play refused:', r.error)
                domRev++
                domPut(dom)
              },
              onUi: (ui) => {
                ;(window as unknown as { __dominoUi: unknown }).__dominoUi = ui
                setDominoUi(ui)
              },
              botName: (seat) => ['Zeca (bot)', 'Lia (bot)', 'Tonho (bot)', 'Nina (bot)'][seat] ?? 'Bot',
              passText: () => 'Passo!',
            },
            onRest: () => { me.loop = null; push() },
            pool: {
              onJoin: (table) => {
                let next = poolJoin(tableOf(table), 'me', seed())
                if (next && q.get('pool') === 'match') next = poolJoin(next, 'p1', seed()) ?? next
                if (next) put(table, next)
              },
              onLeave: (table) => {
                const left = poolLeave(tableOf(table), 'me', seed())
                if (left) put(table, left === 'empty' || q.get('pool') === 'match' ? null : left)
              },
              onShot: (table, n, shot, cue) => {
                const r = poolShoot(tableOf(table), 'me', n, shot, cue)
                if ('state' in r) put(table, r.state)
                else console.warn('[lab] shot refused:', r.error)
              },
              onSettled: (table) => {
                show()
                setTimeout(() => bot(table), 1600)
              },
              onUi: (ui) => {
                ;(window as unknown as { __poolUi: unknown }).__poolUi = ui
                setPoolUi(ui)
              },
            },
          },
        })
        engine.current = world
        ;(window as unknown as { __world: WorldEngine }).__world = world
        rack.current = (table) => {
          const next = poolRack(tableOf(table), 'me', seed())
          if (next) put(table, next)
        }
        const base: WorldRoomLayout = roomId === 'lounge' ? LOUNGE_ROOM : STARTER_ROOM
        const layout: WorldRoomLayout = { ...base, finish: { ...base.finish, mood: `m_${mood}` } }
        const shell = WORLD_SHELLS[layout.shell]
        const domTable = layout.items.find((i) => worldItem(i.sku)?.game === 'domino')?.id
        // The chairs of the domino table are for whoever plays: the lab's crowd sits elsewhere.
        const seats = [...roomSeats(layout)].filter((s) => !domTable || !s.startsWith(domTable + ':'))
        dominoDo.current = {
          start: () => dom && domPut(dominoDeal(dom, seed())),
          bot: (add) => {
            const chair = dom ? dominoBotSeat(dom, dom.seats.indexOf('me'), add) : null
            if (dom && chair !== null) domPut(add ? dominoSit(dom, chair, DOMINO_BOT) : dominoStand(dom, chair))
          },
        }
        const me: WorldPerson = { userId: 'me', name: 'Você', avatar: fakeAvatar(0), k: 0, pose: spawnPose(shell, 0), seat: q.get('sit'), loop: null }
        const others: WorldPerson[] = Array.from({ length: peopleN }, (_, i) => ({
          userId: `p${i + 1}`, name: NAMES[i % NAMES.length]!, avatar: fakeAvatar(i + 1), k: i + 1,
          pose: spawnPose(shell, i + 1), seat: i % 3 !== 2 ? seats[(i * 2) % seats.length] ?? null : null,
          loop: i === 2 ? 'dance' : i === 5 ? 'fold' : null,
        }))
        const push = () => world?.setPeople('me', [{ ...me }, ...others])
        await world.setRoom(layout)
        push()
        domSync(me.seat, domTable)
        world.setScreenSource(video)
        const view = q.get('view')
        if (view && VIEWS[view]) world.setView(...VIEWS[view])
      } catch (err) {
        if (!dead) setError((err as Error).message)
      }
    })()
    const ro = new ResizeObserver(() => world?.resize())
    ro.observe(el)
    const tick = setInterval(() => {
      if (!world) return
      const st = world.stats()
      setStat(`${st.tier}  ${(1000 / st.rafMs).toFixed(0)} fps\n${st.drawCalls} draws  ${(st.triangles / 1000).toFixed(0)}k tris\n${st.textures} tex  ${st.geometries} geo`)
    }, 500)
    return () => {
      dead = true
      clearInterval(tick)
      clearInterval(talk)
      clearTimeout(domTimer)
      ro.disconnect()
      world?.dispose()
      engine.current = null
      ;(video as unknown as { __stop?: () => void } | null)?.__stop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mood, quality])

  return (
    <div className={s.stage} style={{ height: '100vh' }}>
      <div ref={host} className={s.host} />
      <div ref={overlay} className={s.overlay} />
      <div className={s.labBar}>
        {(['starter', 'lounge'] as const).map((r) => <button key={r} onClick={() => setRoomId(r)}>{r}</button>)}
        {(['hora_azul', 'tarde', 'noite'] as const).map((m) => <button key={m} onClick={() => setMood(m)}>{m}</button>)}
        {(['auto', 'low', 'medium', 'high'] as const).map((m) => <button key={m} onClick={() => setQuality(m)}>{m}</button>)}
        {Object.keys(VIEWS).map((v) => <button key={v} onClick={() => engine.current?.setView(...VIEWS[v]!)}>{v}</button>)}
        {WORLD_GESTURES.map((g) => <button key={g} onClick={() => engine.current?.emote('me', { kind: 'gesture', id: g })}>{g}</button>)}
        <button onClick={() => engine.current?.emote('p1', { kind: 'reaction', id: '👏' })}>👏</button>
        <button onClick={() => engine.current?.setWatching(!engine.current.isWatching)}>assistir</button>
      </div>
      {poolUi && (
        <PoolHud
          ui={poolUi} state={poolUi.table ? poolShown[poolUi.table] ?? null : null} meId="me" nameOf={(id) => (id === 'p1' ? NAMES[0]! : id)}
          room={() => engine.current?.pool ?? null} onRack={(table) => rack.current(table)}
        />
      )}
      {dominoUi?.table && (
        <DominoHud
          ui={dominoUi} view={dominoShown.view} at={dominoShown.at} meId="me" nameOf={(id) => id} room={() => engine.current?.domino ?? null}
          onStart={() => dominoDo.current.start()} onBot={(_table, add) => dominoDo.current.bot(add)} onStand={() => engine.current?.standUp()}
        />
      )}
      <div className={s.labStat}>{error ? `ERRO: ${error}` : stat}</div>
    </div>
  )
}
