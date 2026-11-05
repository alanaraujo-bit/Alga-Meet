import { REMOVED_USER_ID } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { REMOVED_ECO } from '../../ui/eco/ecoRules'
import { authorFace, authorName, isRemovedAuthor } from './author'

describe('removed author', () => {
  it('shows the generic label and a neutral face, never the person', () => {
    const gone = { id: REMOVED_USER_ID, displayName: 'Nome antigo', avatarUrl: 'https://x/a.png', accentColor: '#f00', eco: { accent: '#e5484d', eyes: 'slit', hair: 'long', accessory: 'horns' } as const }
    const ana = { id: 'a', displayName: 'Ana', avatarUrl: null }
    expect(isRemovedAuthor(REMOVED_USER_ID)).toBe(true)
    expect(authorName(REMOVED_USER_ID, () => 'Nome antigo')).toBe('Usuário removido')
    expect(authorFace(gone)).toEqual({ id: REMOVED_USER_ID, displayName: 'Usuário removido', avatarUrl: null, eco: REMOVED_ECO })
    expect(authorName('a', () => 'Ana')).toBe('Ana')
    expect(authorFace(ana)).toBe(ana)
  })
})
