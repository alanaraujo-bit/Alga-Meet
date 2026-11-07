import type { PublicUser } from '@alga/shared'
import { Ban, Check, Clock, Copy, MessageCircle, MoreHorizontal, Phone, Shield, UserMinus, UserPlus, UserRound, VolumeX, X } from '@/ui/icons'
import { copyText } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { media, useMedia } from '@/media'
import { openDm, removeRelationship, sendFriendRequest, setRelationship } from '@/store/actions'
import { useData } from '@/store/data'
import { channelTitle } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Button, IconButton, MenuButton, toast, VoiceDot, type MenuEntry } from '@/ui'
import { openSettings } from '../settings/store'
import { giftEntries } from '../billing/TryOn'
import { openSpaceSettings } from '../spaceSettings/store'
import { actorFor, visibleSections } from '../spaceSettings/permissions'
import { userReportEntries } from '../trust/Report'
import { voiceModEntries } from '../voice/moderation'
import { joinVoice, openCall } from '../voice/voice'
import { t } from './strings'
import s from './shell.module.css'

async function run(p: Promise<unknown>, done?: string) {
  try {
    await p
    if (done) toast.success(done)
  } catch (e) {
    toast.error(errorText(e, t.people.error))
  }
}

export async function messageUser(userId: string): Promise<void> {
  try {
    const ch = await openDm([userId])
    useUi.getState().go({ kind: 'dm', channelId: ch.id })
  } catch (e) {
    toast.error(errorText(e, t.people.error))
  }
}

/** Opens the DM and starts (or joins) its call: the voice-first path from any list of people. */
export async function callUser(userId: string): Promise<void> {
  try {
    const ch = await openDm([userId])
    useUi.getState().go({ kind: 'dm', channelId: ch.id })
    await joinVoice(ch.id)
  } catch (e) {
    toast.error(errorText(e, t.people.error))
  }
}

/** Friend actions that depend on where the relationship stands (never offer what the server would refuse). */
function relationEntries(u: PublicUser): MenuEntry[] {
  const rel = useData.getState().relationships[u.id]?.type
  const name = u.displayName
  const block: MenuEntry = { label: t.people.block, icon: Ban, danger: true, onSelect: () => void run(setRelationship(u.id, 'blocked'), t.people.blocked(name)) }
  switch (rel) {
    case 'friend':
      return [{ label: t.people.unfriend, icon: UserMinus, danger: true, onSelect: () => void run(removeRelationship(u.id), t.people.unfriended(name)) }, block]
    case 'incoming':
      return [{ label: t.people.accept, icon: Check, onSelect: () => void run(setRelationship(u.id, 'friend'), t.people.accepted(name)) }, block]
    case 'outgoing':
      return [{ label: t.people.cancelRequest, icon: X, onSelect: () => void run(removeRelationship(u.id)) }, block]
    case 'blocked':
      return [{ label: t.people.unblock, icon: Ban, onSelect: () => void run(removeRelationship(u.id), t.people.unblocked(name)) }]
    default:
      return [{ label: t.people.addFriend, icon: UserPlus, onSelect: () => void run(sendFriendRequest(u.username), t.people.requested(name)) }, block]
  }
}

/**
 * Everything you can do with someone else, in groups: reach them, "for you" in your call, moderation (only with the
 * permission), relationship, then copy and report (last, in red). One list for the member list, the call tile and
 * the profile card's ⋯, so the same person never offers different things in different places.
 */
export function personEntries(user: PublicUser, opts: { spaceId?: string | null; profile?: () => void; reach?: boolean } = {}): MenuEntry[] {
  const st = useData.getState()
  if (user.id === st.me?.id) return opts.profile ? [{ label: t.people.profile, icon: UserRound, onSelect: opts.profile }] : []
  const blocked = st.relationships[user.id]?.type === 'blocked'
  const out: MenuEntry[] = []
  if (opts.profile) out.push({ label: t.people.profile, icon: UserRound, onSelect: opts.profile })
  if (opts.reach !== false && !blocked) {
    out.push({ label: t.people.message, icon: MessageCircle, onSelect: () => void messageUser(user.id) }, { label: t.people.call, icon: Phone, onSelect: () => void callUser(user.id) }, ...giftEntries(user))
  }
  const inMyCall = useMedia.getState().participants[user.id]
  if (inMyCall) {
    out.push(
      { kind: 'group', label: t.people.forYou },
      { label: t.people.muteForMe, icon: VolumeX, checked: inMyCall.locallyMuted, onSelect: () => media.setLocalMute(user.id, !inMyCall.locallyMuted) },
    )
  }
  if (opts.spaceId) {
    const spaceId = opts.spaceId
    const manage: MenuEntry[] = visibleSections(actorFor(st, spaceId)).includes('members') ? [{ label: t.people.manage, icon: Shield, onSelect: () => openSpaceSettings(spaceId, 'members') }] : []
    const mod = voiceModEntries(user.id, spaceId, manage)
    if (mod.length) out.push({ kind: 'group', label: t.people.moderation }, ...mod)
  }
  out.push({ kind: 'separator' }, ...relationEntries(user), { kind: 'separator' }, { label: t.people.copyUsername, icon: Copy, onSelect: () => void copyText(user.username) })
  out.push(...userReportEntries(user).map((e) => ('onSelect' in e ? { ...e, danger: true } : e)))
  return out
}

/**
 * Bottom of someone's profile card: where they are in voice (one click joins), then Mensagem first and the other
 * reaches as icons; the rest (relationship, copy, report) lives in ⋯ so the card never reads as hostile.
 */
/** `actionsOnly`: just the buttons (the full profile shows where they are talking in its own tab). */
export function ProfileFooter({ user, spaceId, onDone, actionsOnly }: { user: PublicUser; spaceId?: string | null; onDone: () => void; actionsOnly?: boolean }) {
  const me = useData((st) => st.me?.id)
  const rel = useData((st) => st.relationships[user.id]?.type)
  const vs = useData((st) => st.voiceStates[user.id])
  const room = useData((st) => (vs ? st.channels[vs.channelId] : undefined))
  const roomName = useData((st) => (room ? channelTitle(st, room) : ''))
  const here = useMedia((st) => !!vs && st.connection.channelId === vs.channelId && st.connection.state !== 'idle')
  const done = (f: () => unknown) => () => {
    onDone()
    void f()
  }

  if (user.id === me)
    return (
      <div className={s.profileFoot}>
        <Button size="sm" full onClick={done(() => openSettings('account'))}>
          {t.people.editProfile}
        </Button>
      </div>
    )
  const relButton =
    rel === 'incoming' ? <IconButton icon={Check} label={t.people.accept} onClick={done(() => run(setRelationship(user.id, 'friend'), t.people.accepted(user.displayName)))} />
    : rel === 'outgoing' ? <IconButton icon={Clock} label={t.people.pending} disabledReason={t.people.pending} />
    : rel === undefined ? <IconButton icon={UserPlus} label={t.people.addFriend} onClick={done(() => run(sendFriendRequest(user.username), t.people.requested(user.displayName)))} />
    : null
  return (
    <>
      {room && !actionsOnly && (
        <div className={s.profileVoice}>
          <VoiceDot />
          <span className={s.profileVoiceText}>{room.spaceId ? t.people.inRoom(roomName) : t.people.inCall}</span>
          {room.spaceId && !here && (
            <Button size="sm" variant="ghost" onClick={done(() => (openCall(room.id), joinVoice(room.id)))}>
              {t.people.join}
            </Button>
          )}
        </div>
      )}
      <div className={s.profileFoot}>
        {rel === 'blocked' ? (
          <Button size="sm" full onClick={done(() => run(removeRelationship(user.id), t.people.unblocked(user.displayName)))}>
            {t.people.unblock}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="primary" icon={MessageCircle} className={s.profileMain} onClick={done(() => messageUser(user.id))}>
              {t.people.message}
            </Button>
            <IconButton icon={Phone} label={t.people.call} onClick={done(() => callUser(user.id))} />
            {relButton}
          </>
        )}
        <MenuButton side="bottom" align="end" label={t.people.more} items={() => personEntries(user, { spaceId, reach: false })}>
          <IconButton icon={MoreHorizontal} label={t.people.more} />
        </MenuButton>
      </div>
    </>
  )
}
