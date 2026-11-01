import { Phone, PhoneOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useData } from '@/store/data'
import { channelTitle, displayName } from '@/store/selectors'
import { Avatar, Button } from '@/ui'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { t } from './strings'
import { acceptRing, declineRing, useVoice } from './voice'
import s from './chrome.module.css'

/** The incoming DM call card over the whole shell (mounted once by Shell): answerable from the keyboard, gone after 30 s. */
export function IncomingCall() {
  const ring = useVoice((st) => st.ring)
  return <AnimatePresence>{ring && <RingCard key={ring.channelId + ring.at} channelId={ring.channelId} fromUserId={ring.fromUserId} />}</AnimatePresence>
}

function RingCard({ channelId, fromUserId }: { channelId: string; fromUserId: string }) {
  const user = useData((st) => st.users[fromUserId])
  const name = useData((st) => displayName(st, fromUserId))
  const channel = useData((st) => st.channels[channelId])
  const title = useData((st) => (channel ? channelTitle(st, channel) : ''))
  const group = channel?.type === 'group_dm'
  return (
    <motion.div
      className={s.ring}
      role="alertdialog"
      aria-label={group ? t.ring.group(title) : t.ring.title(name)}
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.16, ease: EASE_IN } }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') declineRing()
      }}
    >
      <span className={s.ringAvatar}>{user && <Avatar user={user} size={40} decorative />}</span>
      <span className={s.ringText}>
        <span className={s.ringTitle}>{group ? title : name}</span>
        <span className={s.ringSub}>{group ? t.ring.groupBody : t.ring.body}</span>
      </span>
      <Button variant="danger" icon={PhoneOff} onClick={declineRing}>
        {t.ring.decline}
      </Button>
      <Button variant="primary" icon={Phone} onClick={() => void acceptRing()} autoFocus>
        {t.ring.accept}
      </Button>
    </motion.div>
  )
}
