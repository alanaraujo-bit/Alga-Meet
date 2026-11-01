import { REMOVED_USER_ID } from '@alga/shared'
import type { AvatarUser } from '../../ui/Avatar'
import { t } from './strings'

/**
 * An account deleted with "keep as Usuário removido" (REMOVED_USER_ID): its messages stay readable but nothing of
 * the person shows — generic name, neutral disc, no role color, no profile, no report entry.
 */
export const isRemovedAuthor = (id: string) => id === REMOVED_USER_ID
export const authorName = (id: string, named: (id: string) => string) => (isRemovedAuthor(id) ? t.removedAuthor : named(id))
export const authorFace = (a: AvatarUser): AvatarUser =>
  isRemovedAuthor(a.id) ? { id: a.id, displayName: t.removedAuthor, avatarUrl: null, accentColor: 'var(--bg-raised)' } : a
