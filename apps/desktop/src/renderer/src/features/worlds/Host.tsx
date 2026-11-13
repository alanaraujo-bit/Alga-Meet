// What the call's screen shows of Alga Worlds, without loading any of it: whether the stage is the 3D room (the room
// itself is a lazy chunk), the card that says a world is open, and the list of places to open it in. If the room
// throws while loading or drawing, the call's screen comes back whole: the world is a guest on that stage.
import type { Channel, WorldPlace } from '@alga/shared'
import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { useSession } from '@/store/session'
import { Avatar, Button, Icon, toast, type MenuEntry } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { Couch, Cube, DoorOpen, PaintRoller } from '@/ui/icons'
import { amInside, dismissNotice, enterWorld, leaveWorld, openWorld, showWorld, useWorlds, worldFailed } from './store'
import { openStudio } from './studio/store'
import { t } from './strings'
import s from './worlds.module.css'

const WorldStage = lazy(() => import('./WorldStage'))

/** True while this call's stage should be the 3D room. */
export function useWorldOnStage(channelId: string, live: boolean): boolean {
  const meId = useData((st) => st.me?.id)
  return useWorlds((st) => live && st.show && st.session?.channelId === channelId && amInside(st, meId))
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(err: unknown): void {
    console.error('[worlds] the room failed:', err)
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className={s.world}>
        <div className={s.veil} role="alert">
          <Eco state="error" size={56} />
          <strong>{t.failed.title}</strong>
          <span>{t.failed.body}</span>
          <div className={s.veilActions}>
            <Button variant="primary" onClick={worldFailed}>{t.failed.close}</Button>
          </div>
        </div>
      </div>
    )
  }
}

/** The 3D room, filling the call's stage. */
export function WorldOnStage({ channel }: { channel: Channel }) {
  return (
    <Boundary>
      <Suspense fallback={<div className={s.world}><div className={s.veil} role="status"><Eco state="connecting" size={56} /><strong>{t.loading.room}</strong></div></div>}>
        <WorldStage channel={channel} />
      </Suspense>
    </Boundary>
  )
}

/** The places this call's world can be opened in (or moved to), as menu entries. */
export function placeEntries(): MenuEntry[] {
  const st = useWorlds.getState()
  const meId = useData.getState().me?.id
  const place = st.session?.place
  const go = (p: WorldPlace) => () => openWorld(p)
  return [
    { kind: 'group', label: t.open.title },
    { label: t.open.lounge, hint: t.open.loungeHint, icon: Couch, checked: place?.kind === 'lounge', onSelect: go({ kind: 'lounge' }) },
    ...(meId ? [{ label: t.open.mine, hint: t.open.mineHint, icon: DoorOpen, checked: place?.kind === 'room' && place.ownerId === meId, onSelect: go({ kind: 'room', ownerId: meId }) } satisfies MenuEntry] : []),
    { kind: 'separator' },
    { label: t.studio.open, icon: PaintRoller, onSelect: () => openStudio('room') },
  ]
}

/** What the dock's button offers once a world exists. */
export function worldEntries(inside: boolean, onStage: boolean): MenuEntry[] {
  if (!inside) return [{ label: t.card.enter, icon: Cube, onSelect: enterWorld }, { kind: 'separator' }, ...placeEntries()]
  return [
    onStage
      ? { label: t.hud.backToCall, onSelect: () => showWorld(false) }
      : { label: t.card.back, icon: Cube, onSelect: () => showWorld(true) },
    { label: t.hud.leave, hint: t.hud.leaveHint, onSelect: leaveWorld },
    { kind: 'separator' },
    ...placeEntries(),
  ]
}

/** Above the faces of the call: a world is open here, and how to walk in (or back in). */
export function WorldCard({ channel }: { channel: Channel }) {
  const meId = useData((st) => st.me?.id)
  const w = useWorlds(useShallow((st) => ({ session: st.session?.channelId === channel.id ? st.session : null, room: st.room, entering: st.entering, show: st.show })))
  const inside = useWorlds((st) => amInside(st, meId))
  const faces = useData(useShallow((st) => (w.session?.members ?? []).slice(0, 5).map((m) => st.users[m.userId] ?? (m.userId === st.me?.id ? st.me : undefined)).filter((u) => !!u)))
  const host = useData((st) => (w.session ? displayName(st, w.session.hostId, channel.spaceId) : ''))
  if (!w.session) return null
  const n = w.session.members.length
  return (
    <article className={s.card} aria-label={t.card.badge}>
      <div className={s.cardIcon}><Icon icon={Cube} size={20} /></div>
      <div className={s.cardText}>
        <span className={s.cardBadge}>{t.card.badge} · {t.card.openedBy(host)}</span>
        <strong>{w.room?.name ?? t.lounge}</strong>
        <span className={s.cardMeta}>{t.card.inside(n)}</span>
      </div>
      {faces.length > 0 && (
        <div className={s.cardFaces} aria-hidden>
          {faces.map((u) => <Avatar key={u.id} user={u} size={24} />)}
        </div>
      )}
      <Button variant="primary" loading={w.entering} onClick={() => (inside ? showWorld(true) : enterWorld())}>
        {inside ? t.card.back : t.card.enter}
      </Button>
    </article>
  )
}

/** Says, once, why something of the world was refused. Mounted with the shell. */
export function WorldNotices() {
  const notice = useWorlds((st) => st.notice)
  const on = useSession((st) => st.worlds !== null)
  useEffect(() => {
    if (!notice || !on) return
    toast.info(notice)
    dismissNotice()
  }, [notice, on])
  return null
}
