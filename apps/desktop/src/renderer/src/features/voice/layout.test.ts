import { describe, expect, it } from 'vitest'
import { balancedRows, fitGrid, nearestCorner, stageLayout } from './layout'

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

  it('a watched stream gets a big tile on top and the rest keeps a normal grid', () => {
    const l = stageLayout(4, 1200, 700, true)
    expect(l.featured).toBeGreaterThan(700) // ~64 % of the height, 16:9
    expect((l.featured! * 9) / 16).toBeLessThanOrEqual(700 * 0.64 + 1)
    expect(l.rows.reduce((a, b) => a + b, 0)).toBe(3)
    expect(l.width).toBeGreaterThanOrEqual(200)
    // The people below still fit under the stream.
    const rows = l.rows.length
    expect((l.featured! * 9) / 16 + 8 + rows * ((l.width * 9) / 16) + (rows - 1) * 8).toBeLessThanOrEqual(700 + 1)
  })

  it('stream + grid always fit the stage height (the grid keeps its minimum tile)', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      for (const [w, h] of [[960, 652], [1200, 700], [700, 500], [1600, 900]] as const) {
        const l = stageLayout(n, w, h, true)
        const rows = l.rows.length
        expect((l.featured! * 9) / 16 + 8 + rows * ((l.width * 9) / 16) + (rows - 1) * 8).toBeLessThanOrEqual(h + 1)
      }
    }
  })

  it('no featured tile when the stream is alone or nothing is watched', () => {
    expect(stageLayout(1, 1200, 700, true).featured).toBeNull()
    expect(stageLayout(4, 1200, 700, false).featured).toBeNull()
  })

  it('a short stage keeps room for one row of people under the stream', () => {
    const l = stageLayout(3, 1200, 300, true)
    expect((l.featured! * 9) / 16).toBeLessThanOrEqual(300 - (200 * 9) / 16 - 8 + 1)
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
