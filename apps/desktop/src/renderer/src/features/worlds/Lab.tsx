/*
 * Dev-only bench for Alga Worlds (unpackaged builds): the room, its light and its figures without a call or an account.
 * See vite.worlds-lab.config.ts for how to open it and the query parameters. `window.__world` is the engine.
 */
import { useEffect, useRef, useState } from 'react'
import '@/styles/base.css'
import {
  ECO_ACCENTS, LOUNGE_ROOM, STARTER_ROOM, WORLD_GESTURES, WORLD_SHELLS, defaultWorldAvatar, roomSeats, spawnPose, worldEntries,
  type WorldAvatar, type WorldRoomLayout,
} from '@alga/shared'
import { AssetPack } from './assets/pack'
import { WorldEngine, type WorldPerson } from './engine/World'
import type { QualityPref } from './engine/quality'
import s from './worlds.module.css'

const NAMES = ['Ana', 'Bruno', 'Carol', 'Davi', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Íris', 'João', 'Lia', 'Marcos', 'Nina', 'Otto', 'Paula']
const VIEWS: Record<string, [number, number, number, [number, number, number]?]> = {
  // yaw, pitch, distance, target
  wide: [Math.PI * 1.22, 0.3, 7.6, [0.4, 1.2, 0.2]],
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
    void (async () => {
      try {
        await pack.open()
        if (dead) return
        world = new WorldEngine(el, pack, {
          quality, reducedMotion: false, overlay: ov, canvasClass: s.canvas!, label: 'lab',
          hooks: {
            voice: (id) => (levels.get(id) ?? 0) * (0.6 + 0.4 * Math.sin(performance.now() / 90)),
            onStatus: (st) => { if (st.phase === 'error') setError(st.message) },
            onSit: (seat) => { me.seat = seat; push() },
            onStand: (pose) => { me.seat = null; me.pose = pose; push() },
            onRest: () => { me.loop = null; push() },
          },
        })
        engine.current = world
        ;(window as unknown as { __world: WorldEngine }).__world = world
        const base: WorldRoomLayout = roomId === 'lounge' ? LOUNGE_ROOM : STARTER_ROOM
        const layout: WorldRoomLayout = { ...base, finish: { ...base.finish, mood: `m_${mood}` } }
        const shell = WORLD_SHELLS[layout.shell]
        const seats = [...roomSeats(layout)]
        const me: WorldPerson = { userId: 'me', name: 'Você', avatar: fakeAvatar(0), k: 0, pose: spawnPose(shell, 0), seat: null, loop: null }
        const others: WorldPerson[] = Array.from({ length: peopleN }, (_, i) => ({
          userId: `p${i + 1}`, name: NAMES[i % NAMES.length]!, avatar: fakeAvatar(i + 1), k: i + 1,
          pose: spawnPose(shell, i + 1), seat: i % 3 !== 2 ? seats[(i * 2) % seats.length] ?? null : null,
          loop: i === 2 ? 'dance' : i === 5 ? 'fold' : null,
        }))
        const push = () => world?.setPeople('me', [{ ...me }, ...others])
        await world.setRoom(layout)
        push()
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
      <div className={s.labStat}>{error ? `ERRO: ${error}` : stat}</div>
    </div>
  )
}
