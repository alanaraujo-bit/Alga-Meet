import type { ProfileExtras, PublicUser, RecentActivity } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { presenceOf } from '@/store/selectors'
import { Avatar, Button, EmptyState, Icon, IconButton, ScrollArea, Tabs } from '@/ui'
import { Users, Volume2, X } from '@/ui/icons'
import { ActivityIcon, ActivityPanel } from '../activity/Activity'
import { PersonLine, StatusBubble } from '../activity/Status'
import { PHRASE } from '../activity/logic'
import { useActivity } from '../activity/store'
import { ProfileCard } from '../billing/Cosmetics'
import { useLook } from '../billing/store'
import { ProfileFooter } from '../shell/people'
import { joinVoice, openCall } from '../voice/voice'
import s from './profile.module.css'

const t = {
  label: (name: string) => `Perfil de ${name}`,
  close: 'Fechar',
  tabs: { activity: 'Atividade', friends: 'Amigos em comum', spaces: 'Espaços em comum' },
  now: 'Agora',
  inVoice: 'Em voz',
  join: 'Entrar',
  recent: 'Atividade recente',
  nothing: 'Nada por aqui ainda',
  nothingHint: 'Quando jogar ou usar um app que compartilha, aparece aqui.',
  noFriends: 'Nenhum amigo em comum',
  noSpaces: 'Nenhum espaço em comum',
  memberSince: 'Membro desde',
  friendsSince: 'Amigos desde',
  note: 'Nota',
  noteHint: 'só você vê',
  notePlaceholder: 'Clique para adicionar uma nota',
  played: (kind: RecentActivity['kind'], dur: string) => `${kind === 'game' ? 'Jogou' : 'Usou'} por ${dur}`,
  you: 'Você',
}

/** Who the full profile is open for (null = closed). Mounted once (ProfileModalHost). */
export const useProfileModal = create<{ userId: string | null; spaceId: string | null }>()(() => ({ userId: null, spaceId: null }))
export const openProfile = (userId: string, spaceId: string | null = null) => useProfileModal.setState({ userId, spaceId })
const closeProfile = () => useProfileModal.setState({ userId: null })

const longDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 60) return min <= 1 ? 'agora há pouco' : `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
const span = (ms: number) => (ms >= 3600_000 ? `${Math.floor(ms / 3600_000)} h ${String(Math.floor((ms % 3600_000) / 60_000)).padStart(2, '0')} min` : `${Math.max(1, Math.round(ms / 60_000))} min`)

export function ProfileModalHost() {
  const userId = useProfileModal((st) => st.userId)
  return createPortal(<AnimatePresence>{userId && <ProfileDialog key="profile" userId={userId} />}</AnimatePresence>, document.body)
}

function ProfileDialog({ userId }: { userId: string }) {
  const user = useData((st) => st.users[userId])
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeProfile()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])

  if (!user) return null
  return (
    <div className={s.root}>
      <motion.div
        className={s.scrim}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        onPointerDown={closeProfile}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t.label(user.displayName)}
        tabIndex={-1}
        className={s.panel}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.34, ease: [0.32, 0.72, 0, 1] } }}
        exit={{ opacity: 0, scale: 0.98, y: 6, transition: { duration: 0.16 } }}
      >
        <div className={s.close}>
          <IconButton icon={X} label={t.close} shortcut="Esc" onClick={closeProfile} />
        </div>
        <Profile user={user} />
      </motion.div>
    </div>
  )
}

function Profile({ user }: { user: PublicUser }) {
  const spaceId = useProfileModal((st) => st.spaceId)
  const me = useData((st) => st.me?.id)
  const presence = useData((st) => presenceOf(st, user.id))
  const name = useData((st) => (spaceId && st.members[spaceId]?.[user.id]?.nickname) || user.displayName)
  const rel = useData((st) => st.relationships[user.id])
  const look = useLook(user.id)
  const [extras, setExtras] = useState<ProfileExtras | null>(null)
  const mutualSpaces = useMutualSpaces(user.id)
  const [tab, setTab] = useState<'activity' | 'friends' | 'spaces'>('activity')
  const self = user.id === me

  useEffect(() => {
    let live = true
    setExtras(null)
    api<ProfileExtras>('GET', `/users/${user.id}/profile`).then((x) => live && setExtras(x), () => undefined)
    return () => {
      live = false
    }
  }, [user.id])

  return (
    <div className={s.layout}>
      <div className={s.side}>
        <div className={s.cardWrap}>
          <ProfileCard user={user} look={look} name={name} presence={presence === 'offline' ? undefined : presence}>
            <StatusBubble userId={user.id} />
          </ProfileCard>
        </div>
        <div className={s.sideBody}>
          <ProfileFooter user={user} spaceId={spaceId} onDone={closeProfile} />
          <dl className={s.facts}>
            {extras && (
              <motion.div className={s.fact} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <dt>{t.memberSince}</dt>
                <dd>{longDate(extras.memberSince)}</dd>
              </motion.div>
            )}
            {rel?.type === 'friend' && (
              <div className={s.fact}>
                <dt>{t.friendsSince}</dt>
                <dd>{longDate(rel.since)}</dd>
              </div>
            )}
          </dl>
          {!self && me && <Note me={me} them={user.id} />}
        </div>
      </div>

      <div className={s.main}>
        <div className={s.tabs}>
          <Tabs
            label={t.label(name)}
            value={tab}
            onChange={setTab}
            items={[
              { value: 'activity', label: t.tabs.activity },
              ...(self
                ? []
                : [
                    { value: 'friends' as const, label: `${t.tabs.friends}${extras ? ` · ${extras.mutualFriends.length}` : ''}` },
                    { value: 'spaces' as const, label: `${t.tabs.spaces} · ${mutualSpaces.length}` },
                  ]),
            ]}
          />
        </div>
        <ScrollArea className={s.content}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }}
            >
              {tab === 'activity' && <ActivityTab user={user} extras={extras} />}
              {tab === 'friends' && <FriendsTab list={extras?.mutualFriends ?? []} />}
              {tab === 'spaces' && <SpacesTab ids={mutualSpaces} />}
            </motion.div>
          </AnimatePresence>
        </ScrollArea>
      </div>
    </div>
  )
}

function ActivityTab({ user, extras }: { user: PublicUser; extras: ProfileExtras | null }) {
  const activity = useActivity(user.id)
  const vs = useData((st) => st.voiceStates[user.id])
  const room = useData((st) => (vs?.spaceId ? st.channels[vs.channelId] : undefined))
  const spaceName = useData((st) => (vs?.spaceId ? st.spaces[vs.spaceId]?.name : undefined))
  const here = useMedia((st) => !!room && st.connection.channelId === room.id && st.connection.state !== 'idle')
  const recent = extras?.recent ?? []

  if (!activity && !room && recent.length === 0) {
    return <EmptyState title={t.nothing}>{t.nothingHint}</EmptyState>
  }
  return (
    <div className={s.sections}>
      {activity && (
        <section>
          <h3 className={s.h}>{t.now}</h3>
          <ActivityPanel activity={activity} />
        </section>
      )}
      {room && (
        <section>
          <h3 className={s.h}>{t.inVoice}</h3>
          <div className={s.voiceCard}>
            <span className={s.voiceIcon}>
              <Icon icon={Volume2} size={20} />
            </span>
            <div className={s.voiceText}>
              <span className={s.voiceRoom}>{room.name}</span>
              {spaceName && <span className={s.voiceSpace}>em {spaceName}</span>}
            </div>
            {!here && (
              <Button
                size="sm"
                onClick={() => {
                  closeProfile()
                  openCall(room.id)
                  void joinVoice(room.id)
                }}
              >
                {t.join}
              </Button>
            )}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h3 className={s.h}>{t.recent}</h3>
          <ul className={s.recent}>
            {recent.map((r, i) => (
              <motion.li
                key={`${r.kind}|${r.name}`}
                className={s.recentRow}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.24, ease: [0.165, 0.84, 0.44, 1] }}
              >
                <ActivityIcon activity={{ kind: r.kind, name: r.name, startedAt: 0, icon: r.icon, steamAppId: r.steamAppId }} size={40} />
                <div className={s.recentText}>
                  <span className={s.recentName}>{r.name}</span>
                  <span className={s.recentMeta}>
                    {t.played(r.kind, span(r.totalMs))} · {ago(r.lastAt)}
                  </span>
                </div>
                <span className={s.recentKind}>{PHRASE[r.kind].verb}</span>
              </motion.li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FriendsTab({ list }: { list: PublicUser[] }) {
  if (!list.length) return <EmptyState icon={Users} title={t.noFriends} />
  return (
    <ul className={s.people}>
      {list.map((u) => (
        <li key={u.id}>
          <button type="button" className={s.person} onClick={() => openProfile(u.id)}>
            <PersonAvatar user={u} />
            <span className={s.personText}>
              <span className={s.personName}>{u.displayName}</span>
              <span className={s.personSub}>
                <PersonLine userId={u.id} fallback={`@${u.username}`} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function PersonAvatar({ user }: { user: PublicUser }) {
  const presence = useData((st) => presenceOf(st, user.id))
  return <Avatar user={user} size={32} presence={presence} decorative />
}

function SpacesTab({ ids }: { ids: string[] }) {
  const spaces = useData((st) => st.spaces)
  const members = useData((st) => st.members)
  if (!ids.length) return <EmptyState icon={Users} title={t.noSpaces} />
  return (
    <ul className={s.people}>
      {ids.map((id) => {
        const sp = spaces[id]
        if (!sp) return null
        return (
          <li key={id} className={s.space}>
            <span className={s.spaceIcon}>{sp.iconUrl ? <img src={sp.iconUrl} alt="" /> : sp.name.slice(0, 2).toUpperCase()}</span>
            <span className={s.personText}>
              <span className={s.personName}>{sp.name}</span>
              <span className={s.personSub}>{Object.keys(members[id] ?? {}).length} membros</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function useMutualSpaces(userId: string): string[] {
  const members = useData((st) => st.members)
  const order = useData((st) => st.spaceOrder)
  return useMemo(() => order.filter((id) => !!members[id]?.[userId]), [members, order, userId])
}

/** Private note about someone: on this PC only, never sent anywhere. */
function Note({ me, them }: { me: string; them: string }) {
  const key = `alga.note.${me}.${them}`
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? '')
  const save = (v: string) => {
    if (v.trim()) localStorage.setItem(key, v)
    else localStorage.removeItem(key)
  }
  return (
    <label className={s.note}>
      <span className={s.noteLabel}>
        {t.note} <span className={s.noteHint}>({t.noteHint})</span>
      </span>
      <textarea
        className={s.noteInput}
        value={value}
        maxLength={256}
        rows={2}
        placeholder={t.notePlaceholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
      />
    </label>
  )
}

