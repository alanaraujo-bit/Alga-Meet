import { DOMINO_BOT, dominoDeal, dominoSit, dominoView, newDomino, type DominoState } from '@alga/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyDomino, dominoRefused, useDomino } from './store'

function game(): DominoState {
  let s = newDomino('dom')
  s = dominoSit(s, 0, 'me')!
  s = dominoSit(s, 2, DOMINO_BOT)!
  return dominoDeal(s, 5)!
}

describe('the domino store', () => {
  beforeEach(() => useDomino.setState({ tables: {}, at: {}, rev: 0 }))

  it('keeps the latest word on each table and when it came, and forgets a table nobody sits at', () => {
    const view = dominoView(game(), 'me')
    applyDomino('dom', view, 1000)
    applyDomino('mesa2', { ...view, table: 'mesa2' }, 1500)
    expect(useDomino.getState().tables.dom).toBe(view)
    expect(useDomino.getState().at).toEqual({ dom: 1000, mesa2: 1500 })
    applyDomino('dom', null)
    expect(Object.keys(useDomino.getState().tables)).toEqual(['mesa2'])
    expect(useDomino.getState().at).toEqual({ mesa2: 1500 })
  })

  it('a refused play asks the room to show the server\'s word again, without touching the tables', () => {
    const view = dominoView(game(), 'me')
    applyDomino('dom', view, 1)
    const tables = useDomino.getState().tables
    dominoRefused()
    expect(useDomino.getState().rev).toBe(1)
    expect(useDomino.getState().tables).toBe(tables)
  })
})
