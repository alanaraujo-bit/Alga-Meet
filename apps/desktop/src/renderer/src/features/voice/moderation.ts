import { Permission } from '@alga/shared'
import { ArrowRightLeft, HeadphoneOff, Headphones, Mic, MicOff, PhoneOff } from 'lucide-react'
import { errorText } from '@/lib/errors'
import { moderateVoice } from '@/store/actions'
import { useData } from '@/store/data'
import { can, spaceChannels, spacePermissions } from '@/store/selectors'
import { toast, type MenuEntry } from '@/ui'
import { t } from './strings'

/** Voice moderation for someone in one of this space's voice channels: only what your permissions allow. */
export function voiceModEntries(userId: string, spaceId: string, extra: MenuEntry[] = []): MenuEntry[] {
  const st = useData.getState()
  const vs = st.voiceStates[userId]
  if (!vs || vs.spaceId !== spaceId || userId === st.me?.id) return extra
  const perms = spacePermissions(st, spaceId)
  const run = (body: Parameters<typeof moderateVoice>[2]) => () =>
    void moderateVoice(spaceId, userId, body).catch((e: unknown) => toast.error(errorText(e, t.mod.failed)))
  const mod: MenuEntry[] = []
  if (can(perms, Permission.MUTE_MEMBERS)) mod.push({ label: vs.serverMute ? t.mod.unmute : t.mod.mute, icon: vs.serverMute ? Mic : MicOff, onSelect: run({ serverMute: !vs.serverMute }) })
  if (can(perms, Permission.DEAFEN_MEMBERS)) mod.push({ label: vs.serverDeaf ? t.mod.undeafen : t.mod.deafen, icon: vs.serverDeaf ? Headphones : HeadphoneOff, onSelect: run({ serverDeaf: !vs.serverDeaf }) })
  const move = can(perms, Permission.MOVE_MEMBERS)
  if (move) mod.push({ label: t.mod.disconnect, icon: PhoneOff, danger: true, onSelect: run({ channelId: null }) })
  mod.push(...extra)
  const others = move ? spaceChannels(st, spaceId).voice.filter((c) => c.id !== vs.channelId) : []
  if (others.length) {
    mod.push({ kind: 'group', label: t.mod.moveTo })
    for (const c of others) mod.push({ label: c.name, icon: ArrowRightLeft, onSelect: run({ channelId: c.id }) })
  }
  return mod
}
