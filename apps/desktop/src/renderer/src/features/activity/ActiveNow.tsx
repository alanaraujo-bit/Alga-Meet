import type { Activity, PublicUser } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { presenceOf } from '@/store/selectors'
import { Avatar, Button, Icon, ScrollArea } from '@/ui'
import { Volume2 } from '@/ui/icons'
import { joinVoice, openCall } from '../voice/voice'
import { ActivityPanel } from './Activity'
import { sentence } from './logic'
import { t } from './strings'
import s from './activity.module.css'

interface Entry {
  user: PublicUser
  activity?: Activity
  room?: { id: string; name: string }
}

/**
 * Friends tab, right column: who is doing something right now (playing, creating, in a room), most social first.
 * The point is a reason to say "bora?" — so a room comes with its door.
 */
export function ActiveNow() {
  const relationships = useData((st) => st.relationships)
  const activities = useData((st) => st.activities)
  const voiceStates = useData((st) => st.voiceStates)
  const channels = useData((st) => st.channels)
  const users = useData((st) => st.users)

  const entries = useMemo(() => {
    const list: Entry[] = []
    for (const r of Object.values(relationships)) {
      if (r.type !== 'friend') continue
      const id = r.user.id
      const vs = voiceStates[id]
      const ch = vs?.spaceId ? channels[vs.channelId] : undefined
      const e: Entry = { user: users[id] ?? r.user, activity: activities[id], room: ch ? { id: ch.id, name: ch.name } : undefined }
      if (e.activity || e.room) list.push(e)
    }
    const score = (e: Entry) => (e.room ? 2 : 0) + (e.activity ? 1 : 0)
    return list.sort((a, b) => score(b) - score(a) || (b.activity?.startedAt ?? 0) - (a.activity?.startedAt ?? 0))
  }, [relationships, activities, voiceStates, channels, users])

  return (
    <aside className={s.activeNow} aria-label={t.activeNow.title}>
      <h2 className={s.activeTitle}>{t.activeNow.title}</h2>
      {entries.length === 0 ? (
        <p className={s.activeEmpty}>{t.activeNow.empty}</p>
      ) : (
        <ScrollArea className={s.activeList}>
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <motion.div
                key={e.user.id}
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <ActiveCard entry={e} />
              </motion.div>
            ))}
          </AnimatePresence>
        </ScrollArea>
      )}
    </aside>
  )
}

function ActiveCard({ entry: { user, activity, room } }: { entry: Entry }) {
  const presence = useData((st) => presenceOf(st, user.id))
  const here = useMedia((st) => !!room && st.connection.channelId === room.id && st.connection.state !== 'idle')
  return (
    <div className={s.activeCard}>
      <div className={s.activeWho}>
        <Avatar user={user} size={32} presence={presence} decorative />
        <div className={s.text}>
          <span className={s.activeName}>{user.displayName}</span>
          <span className={s.activeSub}>{activity ? sentence(activity.kind, activity.name) : room && t.activeNow.inRoom(room.name)}</span>
        </div>
      </div>
      {activity && <ActivityPanel key={`${activity.name}|${activity.startedAt}`} activity={activity} compact />}
      {room && (
        <div className={s.activeRoom}>
          <span className={s.activeRoomName}>
            <Icon icon={Volume2} size={14} />
            {room.name}
          </span>
          {!here && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t.activeNow.joinLabel(room.name)}
              onClick={() => {
                openCall(room.id)
                void joinVoice(room.id)
              }}
            >
              {t.activeNow.join}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
