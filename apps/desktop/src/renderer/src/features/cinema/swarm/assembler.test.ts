import { describe, expect, it } from 'vitest'
import { Assembler } from './assembler'

const piece = Uint8Array.from({ length: 10 }, (_, i) => i + 1)
const part = (from: number, to: number) => piece.subarray(from, to)

describe('Assembler', () => {
  it('assembles chunks that arrive out of order', () => {
    const a = new Assembler()
    expect(a.add('p', 'v:1', 6, 10, part(6, 10))).toBeNull()
    expect(a.add('p', 'v:1', 0, 10, part(0, 3))).toBeNull()
    expect(a.add('p', 'v:1', 3, 10, part(3, 6))).toEqual(piece)
  })

  it('ignores a duplicate chunk', () => {
    const a = new Assembler()
    expect(a.add('p', 'v:1', 0, 10, part(0, 5))).toBeNull()
    expect(a.add('p', 'v:1', 0, 10, part(0, 5))).toBeNull()
    expect(a.add('p', 'v:1', 5, 10, part(5, 10))).toEqual(piece)
  })

  it('discards the partial piece of a removed peer', () => {
    const a = new Assembler()
    a.add('p', 'v:1', 0, 10, part(0, 5))
    a.dropPeer('p')
    expect(a.add('p', 'v:1', 5, 10, part(5, 10))).toBeNull()
    expect(a.add('p', 'v:1', 0, 10, part(0, 5))).toEqual(piece)
  })

  it('restarts when another peer or another size shows up for the same piece, and on drop', () => {
    const a = new Assembler()
    a.add('p', 'v:1', 0, 10, part(0, 5))
    expect(a.add('q', 'v:1', 5, 10, part(5, 10))).toBeNull()
    a.add('q', 'v:1', 0, 12, new Uint8Array(6))
    expect(a.add('q', 'v:1', 0, 10, part(0, 5))).toBeNull()
    a.drop('v:1')
    expect(a.add('q', 'v:1', 5, 10, part(5, 10))).toBeNull()
  })
})
