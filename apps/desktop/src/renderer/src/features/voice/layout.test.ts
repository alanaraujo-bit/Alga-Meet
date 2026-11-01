import { describe, expect, it } from 'vitest'
import { balancedRows, featuredWidth, fitGrid, nearestCorner, stageLayout, stripTile } from './layout'

describe('call grid', () => {
  it('balances rows so no tile is left alone on the last one', () => {
    expect(balancedRows(7, 3)).toEqual([3, 2, 2])
    expect(balancedRows(5, 3)).toEqual([3, 2])
    expect(balancedRows(5, 4)).toEqual([3, 2])
    expect(balancedRows(3, 2)).toEqual([2, 1]) // 3 in 2 columns: the classic 2 + 1, centered
    expect(balancedRows(8, 3)).toEqual([3, 3, 2])
    expect(balancedRows(6, 3)).toEqual([3, 3])
    expect(balancedRows(1, 1)).toEqual([1])
    expect(balancedRows(0, 3)).toEqual([])
  })

  it('rows never hold more tiles than fit side by side at the minimum width', () => {
    const g = fitGrid(12, 600, 300)
    expect(g.width).toBe(200)
    expect(g.cols * 200 + (g.cols - 1) * 8).toBeLessThanOrEqual(600)
  })

  it('a watched stream takes the stage at any headcount, above one strip of people', () => {
    // 2 people in the 976×652 box of a 1320×840 window: the stream is no longer a tile like the others.
    const w = featuredWidth(976, 652)
    expect(w).toBe(976)
    expect((w * 9) / 16 + 8 + 90).toBeLessThanOrEqual(652)
    // A short or narrow stage: still the largest 16:9 that leaves room for the strip.
    for (const [bw, bh] of [[600, 412], [1600, 900], [700, 300]] as const) {
      const f = featuredWidth(bw, bh)
      expect(f).toBeLessThanOrEqual(bw)
      expect((f * 9) / 16 + 8 + stripTile(bh).h).toBeLessThanOrEqual(bh + 1)
    }
  })

  it('the strip shrinks on short stages', () => {
    expect(stripTile(652)).toEqual({ w: 160, h: 90 })
    expect(stripTile(412)).toEqual({ w: 120, h: 68 })
  })

  it('the grid fits everyone in balanced rows', () => {
    const l = stageLayout(7, 1008, 652)
    expect(l.rows).toEqual([3, 2, 2])
    expect(l.width).toBeGreaterThanOrEqual(200)
  })
})

describe('mini-player', () => {
  it('snaps to the corner nearest its center', () => {
    expect(nearestCorner(900, 500, 320, 180, 1280, 800)).toBe('br')
    expect(nearestCorner(10, 20, 320, 180, 1280, 800)).toBe('tl')
    expect(nearestCorner(700, 30, 320, 180, 1280, 800)).toBe('tr')
    expect(nearestCorner(100, 600, 320, 180, 1280, 800)).toBe('bl')
  })
})
