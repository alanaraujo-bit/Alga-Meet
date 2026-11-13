// The 3D room on the call's stage. This file (and the engine it brings) is its own chunk, loaded when someone first
// walks into a world: the app starts and calls exactly as before for everyone who never does.
import { WORLD_GESTURES, WORLD_LOOP_GESTURES, WORLD_REACTIONS, defaultWorldAvatar, type Channel, type WorldGesture } from '@alga/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { displayName, voiceMembers } from '@/store/selectors'
import { onDispatch, useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Button, Icon, IconButton, MenuButton, Tooltip, type MenuEntry } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { Check, DoorOpen, Eye, HandWaving, LogOut, Minimize, PaintRoller, Settings2, Television } from '@/ui/icons'
import { openStudio } from './studio/store'
import { levelNow } from '../voice/levels'
import { AssetPack, PackError, resolveAssetsUrl, type PackProgress } from './assets/pack'
import { WorldEngine, type EngineStatus, type WorldPerson } from './engine/World'
import { QUALITY_TIERS, type QualityPref, type QualityTier } from './engine/quality'
import { emote, leaveWorld, rest, sendMove, setQuality, setTv, showWorld, sit, stand, useWorlds, worldFailed } from './store'
import { t } from './strings'
import s from './worlds.module.css'

type Phase = { kind: 'pack' } | { kind: 'room' } | { kind: 'people' } | { kind: 'ready' } | { kind: 'error'; message: string }

/** Whose screen the room's screens show: the one chosen for the room if it is still live, else whoever is sharing. */
function screenOf(tv: string | null, streaming: string[], meId: string | null): string | null {
  if (tv && streaming.includes(tv)) return tv
  const others = streaming.filter((id) => id !== meId)
  return others[0] ?? streaming[0] ?? null
}

export default function WorldStage({ channel }: { channel: Channel }) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const feed = useRef<HTMLVideoElement>(null)
  const engine = useRef<WorldEngine | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'pack' })
  const [progress, setProgress] = useState<PackProgress>({ loaded: 0, total: 0 })
  const [attempt, setAttempt] = useState(0)
  const [seatHint, setSeatHint] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const [tier, setTier] = useState<QualityTier | null>(null)
  /** Grows when a new engine exists: what feeds it runs again. */
  const [engineReady, setEngineReady] = useState(0)

  const meId = useData((st) => st.me?.id ?? null)
  const assetsUrl = useSession((st) => st.worlds?.assetsUrl ?? null)
  const reducedMotion = useUi((st) => st.reducedMotion)
  const world = useWorlds(useShallow((st) => ({ session: st.session, room: st.room, quality: st.quality })))
  const users = useData((st) => st.users)
  const me = useData((st) => st.me)
  const voiceStates = useData((st) => st.voiceStates)
  const callIds = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  const names = useData(useShallow((st) => Object.fromEntries((world.session?.members ?? []).map((m) => [m.userId, displayName(st, m.userId, channel.spaceId)]))))

  const people = useMemo<WorldPerson[]>(() => (world.session?.members ?? []).map((m) => {
    const u = m.userId === me?.id ? me : users[m.userId]
    return {
      userId: m.userId, name: names[m.userId] ?? '', k: m.k, pose: m.pose, seat: m.seat, loop: m.loop,
      avatar: u?.world ?? defaultWorldAvatar(m.userId, u?.eco),
    }
  }), [world.session, users, me, names])
  const mine = world.session?.members.find((m) => m.userId === meId)

  // The engine lives as long as this stage is on screen; leaving it frees the GPU.
  useEffect(() => {
    const el = host.current, ov = overlay.current
    if (!el || !ov || !assetsUrl) return
    let dead = false
    let created: WorldEngine | null = null
    setPhase({ kind: 'pack' })
    const pack = new AssetPack(resolveAssetsUrl(assetsUrl, window.alga.config.apiUrl))
    const offProgress = pack.onProgress((p) => !dead && setProgress(p))
    const fail = (message: string) => !dead && setPhase({ kind: 'error', message })
    void (async () => {
      try {
        await pack.open()
        if (dead) return
        created = new WorldEngine(el, pack, {
          quality: useWorlds.getState().quality,
          reducedMotion: useUi.getState().reducedMotion,
          overlay: ov,
          canvasClass: s.canvas!,
          label: useWorlds.getState().room?.name ?? t.name,
          hooks: {
            onMove: sendMove,
            onSit: sit,
            onStand: stand,
            onRest: rest,
            onSeatHint: (seat) => !dead && setSeatHint(seat),
            onTier: (q) => !dead && setTier(q),
            voice: levelNow,
            onStatus: (st: EngineStatus) => {
              if (dead) return
              if (st.phase === 'error') setPhase({ kind: 'error', message: st.reason === 'context_lost' ? t.failed.contextLost : t.failed.body })
              else setPhase(st.phase === 'ready' ? { kind: 'ready' } : { kind: st.step })
            },
          },
        })
        engine.current = created
        setEngineReady((n) => n + 1)
      } catch (err) {
        fail(err instanceof PackError && (err.kind === 'offline' || err.kind === 'missing') ? t.failed.offline : t.failed.body)
        console.warn('[worlds] could not start:', (err as Error).message)
      }
    })()
    const ro = new ResizeObserver(() => engine.current?.resize())
    ro.observe(el)
    return () => {
      dead = true
      offProgress()
      ro.disconnect()
      created?.dispose()
      engine.current = null
    }
  }, [assetsUrl, attempt])

  // Room: rebuilt only when the layout changes (WorldRoomView.rev).
  const room = world.room
  const rev = room ? `${room.place.kind}:${room.place.kind === 'room' ? room.place.ownerId : ''}:${room.rev}` : null
  useEffect(() => {
    const e = engine.current
    if (!e || !room) return
    e.setRoom({ shell: room.shell, finish: room.finish, items: room.items }).catch((err: unknown) => console.warn('[worlds] room failed:', (err as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, engineReady])

  useEffect(() => {
    engine.current?.setPeople(meId, people)
  }, [people, meId, engineReady])

  useEffect(() => {
    engine.current?.setQuality(world.quality)
  }, [world.quality, engineReady])
  useEffect(() => {
    engine.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion, engineReady])

  // Positions and gestures go straight from the gateway to the engine: nothing here re-renders per tick.
  useEffect(() => onDispatch((d) => {
    if (d.t === 'WORLD_TICK' && d.d.channelId === channel.id) engine.current?.applyTick(d.d.e)
    else if (d.t === 'WORLD_EMOTE' && d.d.channelId === channel.id) engine.current?.emote(d.d.userId, d.d.emote)
  }), [channel.id])

  // The room's screens show a screen share of this call, decoded by the call's own media engine.
  const streaming = useMemo(() => callIds.filter((v) => v.streaming).map((v) => v.userId), [callIds])
  const ownShare = useMedia((st) => st.screen.active)
  const live = useMemo(() => (ownShare && meId && !streaming.includes(meId) ? [...streaming, meId] : streaming), [streaming, ownShare, meId])
  const tvUser = screenOf(world.session?.tv ?? null, live, meId)
  useEffect(() => {
    const e = engine.current, video = feed.current
    if (!e || !video) return
    if (!tvUser) return void e.setScreenSource(null)
    let detach: () => void
    let started = false
    if (tvUser === meId) {
      detach = media.attachOwnScreen(video)
    } else {
      // Watching is opt-in in the call: start it for the room's screen, and stop it again only if we started it.
      started = !useMedia.getState().viewers[tvUser]
      if (started) media.watch(tvUser, 'auto')
      detach = media.attachScreen(tvUser, video)
    }
    e.setScreenSource(video)
    return () => {
      e.setScreenSource(null)
      detach()
      if (started && useMedia.getState().connection.channelId === channel.id) media.unwatch(tvUser)
    }
  }, [tvUser, meId, channel.id, engineReady])

  const toggleWatch = useCallback(() => {
    const e = engine.current
    if (!e) return
    e.setWatching(!e.isWatching)
    setWatching(e.isWatching)
  }, [])

  const gestureItems = useCallback((): MenuEntry[] => WORLD_GESTURES.map((id: WorldGesture) => ({
    label: t.gestures[id],
    checked: mine?.loop === id,
    onSelect: () => (mine?.loop === id ? rest() : emote({ kind: 'gesture', id })),
    hint: WORLD_LOOP_GESTURES.includes(id) ? '∞' : undefined,
  })), [mine?.loop])

  const screenItems = useCallback((): MenuEntry[] => {
    const st = useData.getState()
    if (!live.length) return [{ label: t.hud.screenNobody, onSelect: () => {}, disabled: true }]
    return [
      { label: t.hud.screenAuto, checked: !world.session?.tv, onSelect: () => setTv(null) },
      { kind: 'separator' },
      ...live.map((id): MenuEntry => ({ label: t.hud.screenOf(displayName(st, id, channel.spaceId)), checked: world.session?.tv === id, onSelect: () => setTv(id) })),
    ]
  }, [live, world.session?.tv, channel.spaceId])

  const qualityItems = useCallback((): MenuEntry[] => [
    { kind: 'group', label: t.hud.quality },
    ...(['auto', ...QUALITY_TIERS] as QualityPref[]).map((q): MenuEntry => ({
      label: q === 'auto' && tier ? `${t.quality.auto} · ${t.quality[tier].toLowerCase()}` : t.quality[q],
      checked: world.quality === q,
      onSelect: () => setQuality(q),
    })),
  ], [world.quality, tier])

  const seated = !!mine?.seat
  const ready = phase.kind === 'ready'

  return (
    <div className={s.world}>
      {/* Behind the canvas on purpose: the call's adaptive stream sizes the video by this element. */}
      <video ref={feed} className={s.feed} autoPlay playsInline muted />
      <div ref={host} className={s.host} />
      <div ref={overlay} className={s.overlay} />

      {ready && (
        <>
          <div className={s.place}>
            <Icon icon={DoorOpen} size={14} />
            <span>{room?.name}</span>
          </div>
          <div className={s.hud} role="toolbar" aria-label={t.hud.toolbar}>
            <MenuButton items={gestureItems} side="top" label={t.hud.gestures}>
              <IconButton icon={HandWaving} label={t.hud.gestures} tooltipSide="top" />
            </MenuButton>
            <div className={s.reactions} role="group" aria-label={t.hud.reactions}>
              {WORLD_REACTIONS.map((r) => (
                <button key={r} type="button" className={s.reaction} onClick={() => emote({ kind: 'reaction', id: r })} aria-label={r}>{r}</button>
              ))}
            </div>
            <span className={s.hudSep} />
            <Tooltip content={watching ? t.hud.stopWatching : t.hud.watch} side="top">
              <button type="button" className={`${s.hudButton} ${watching ? s.on : ''}`} aria-label={watching ? t.hud.stopWatching : t.hud.watch} aria-pressed={watching} onClick={toggleWatch} disabled={!tvUser}>
                <Icon icon={Eye} size={16} />
              </button>
            </Tooltip>
            <MenuButton items={screenItems} side="top" label={t.hud.screen}>
              <IconButton icon={Television} label={t.hud.screen} tooltipSide="top" />
            </MenuButton>
            <MenuButton items={qualityItems} side="top" label={t.hud.quality}>
              <IconButton icon={Settings2} label={t.hud.quality} tooltipSide="top" />
            </MenuButton>
            <span className={s.hudSep} />
            <IconButton icon={PaintRoller} label={t.studio.open} tooltipSide="top" onClick={() => openStudio('room')} />
            <IconButton icon={Minimize} label={t.hud.backToCall} tooltipSide="top" onClick={() => showWorld(false)} />
            <IconButton icon={LogOut} label={t.hud.leave} tooltipSide="top" onClick={leaveWorld} />
          </div>
          {(seatHint || seated) && (
            <div className={s.hint} role="status">
              <kbd>E</kbd>
              <span>{seated ? t.hud.stand : t.hud.sit}</span>
            </div>
          )}
        </>
      )}

      {phase.kind !== 'ready' && phase.kind !== 'error' && (
        <div className={s.veil} role="status" aria-live="polite">
          <Eco state="connecting" size={56} />
          <strong>{phase.kind === 'pack' ? t.loading.pack : phase.kind === 'room' ? t.loading.room : t.loading.people}</strong>
          {progress.total > 0 && (
            <>
              <div className={s.bar}><i style={{ transform: `scaleX(${Math.min(1, progress.loaded / progress.total)})` }} /></div>
              <span>{t.loading.first}</span>
            </>
          )}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className={s.veil} role="alert">
          <Eco state="error" size={56} />
          <strong>{t.failed.title}</strong>
          <span>{phase.message}</span>
          <div className={s.veilActions}>
            <Button variant="ghost" onClick={worldFailed}>{t.failed.close}</Button>
            <Button variant="primary" icon={Check} onClick={() => setAttempt((n) => n + 1)}>{t.failed.retry}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
