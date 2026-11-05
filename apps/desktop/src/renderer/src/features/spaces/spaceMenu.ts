import { Permission } from '@alga/shared'
import { Bell, BellOff, CheckCheck, Flag, Hash, LogOut, Settings, UserPlus, Volume2 } from '@/ui/icons'
import { defaultLevelOf, HOUR, isMuted, mute, setLevel, unmute, useNotify, type NotifyLevel } from '../app/notifyPrefs'
import { markSpaceRead } from '@/store/actions'
import { useData } from '@/store/data'
import { can, spacePermissions } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { openReport } from '../trust/Report'
import { t as tr } from '../trust/strings'
import type { MenuEntry } from '@/ui'
import { House } from '../billing/icons'
import { openCasa } from '../billing/store'
import { t as tb } from '../billing/strings'
import { t } from '../shell/strings'
import { actorFor, visibleSections } from '../spaceSettings/permissions'
import { openSpaceSettings } from '../spaceSettings/store'
import { t as tss } from '../spaceSettings/strings'
import { t as ts } from './strings'

const hhmm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "Notificações": the three levels (the default named as such) and a 1-hour silence that undoes itself. */
function notifyEntries(spaceId: string): MenuEntry[] {
  const n = t.space.notify
  const chosen = useNotify.getState().levels[spaceId]
  const fallback = defaultLevelOf(spaceId)
  const current = chosen ?? fallback
  const level = (l: NotifyLevel, label: string): MenuEntry => ({
    label,
    checked: current === l,
    hint: !chosen && l === fallback ? n.byDefault : undefined,
    onSelect: () => setLevel(spaceId, l),
  })
  const until = useNotify.getState().muted[spaceId]
  return [
    { kind: 'separator' },
    { kind: 'group', label: n.title },
    level('all', n.all),
    level('mentions', n.mentions),
    level('none', n.none),
    isMuted(spaceId) && until
      ? { label: n.unmute(hhmm.format(until)), icon: Bell, onSelect: () => unmute(spaceId) }
      : { label: n.muteHour, icon: BellOff, onSelect: () => mute(spaceId, HOUR) },
  ]
}

/** Same entries for the rail context menu and the sidebar header dropdown. */
export function spaceMenu(spaceId: string): MenuEntry[] {
  const d = useData.getState()
  const sp = d.spaces[spaceId]
  if (!sp) return []
  const perms = spacePermissions(d, spaceId)
  const ui = useUi.getState()
  const items: MenuEntry[] = []
  if (can(perms, Permission.CREATE_INVITES)) items.push({ label: t.space.invite, icon: UserPlus, onSelect: () => ui.openModal({ kind: 'invite', spaceId }) })
  if (can(perms, Permission.MANAGE_CHANNELS)) {
    items.push(
      { label: t.space.createText, icon: Hash, onSelect: () => ui.openModal({ kind: 'createChannel', spaceId, type: 'text' }) },
      { label: t.space.createVoice, icon: Volume2, onSelect: () => ui.openModal({ kind: 'createChannel', spaceId, type: 'voice' }) },
    )
  }
  if (visibleSections(actorFor(d, spaceId)).length) items.push({ label: tss.open, icon: Settings, onSelect: () => openSpaceSettings(spaceId) })
  // Casa: every member sees the space's Casa (perks, mural); contributing is 18+ and explained inside.
  items.push({ label: tb.casa.menu, icon: House, onSelect: () => openCasa(spaceId) })
  if (items.length) items.push({ kind: 'separator' })
  items.push({ label: t.space.markRead, icon: CheckCheck, onSelect: () => markSpaceRead(spaceId) })
  items.push(...notifyEntries(spaceId))
  // The owner cannot leave (the server forbids it): the item stays, disabled, and says why.
  if (sp.ownerId !== d.me?.id) {
    items.push(
      { kind: 'separator' },
      { label: tr.report.menu.space, icon: Flag, onSelect: () => openReport({ kind: 'space', spaceId }) },
      { label: t.space.leave, icon: LogOut, danger: true, onSelect: () => ui.openModal({ kind: 'leaveSpace', spaceId }) },
    )
  } else {
    items.push({ kind: 'separator' }, { label: t.space.leave, icon: LogOut, disabled: true, hint: ts.menu.ownerCantLeave, onSelect: () => undefined })
  }
  return items
}
