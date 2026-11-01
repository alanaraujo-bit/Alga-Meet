import { Permission } from '@alga/shared'
import { CheckCheck, Flag, Hash, LogOut, Settings, UserPlus, Volume2 } from 'lucide-react'
import { markSpaceRead } from '@/store/actions'
import { useData } from '@/store/data'
import { can, spacePermissions } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { openReport } from '../trust/Report'
import { t as tr } from '../trust/strings'
import type { MenuEntry } from '@/ui'
import { t } from '../shell/strings'
import { actorFor, visibleSections } from '../spaceSettings/permissions'
import { openSpaceSettings } from '../spaceSettings/store'
import { t as tss } from '../spaceSettings/strings'
import { t as ts } from './strings'

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
  if (items.length) items.push({ kind: 'separator' })
  items.push({ label: t.space.markRead, icon: CheckCheck, onSelect: () => markSpaceRead(spaceId) })
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
