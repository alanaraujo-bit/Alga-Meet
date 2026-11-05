interface Part { peer: string; total: number; buf: Uint8Array<ArrayBuffer>; seen: Set<number>; got: number }

/**
 * Rebuilds pieces from chunks, one partial per piece key. Chunks may come in any order; a repeated offset is ignored;
 * a chunk from another peer or with another total restarts the piece. Integrity is checked by the caller (SHA-256).
 */
export class Assembler {
  private readonly parts = new Map<string, Part>()

  /**
   * The whole piece when its last byte arrives; else true if the chunk was taken, false if it repeated an offset (not
   * progress). Callers validate offset + length ≤ total.
   */
  add(peer: string, key: string, offset: number, total: number, data: Uint8Array): Uint8Array<ArrayBuffer> | boolean {
    let p = this.parts.get(key)
    if (!p || p.peer !== peer || p.total !== total) {
      p = { peer, total, buf: new Uint8Array(total), seen: new Set(), got: 0 }
      this.parts.set(key, p)
    }
    if (p.seen.has(offset)) return false
    p.seen.add(offset)
    p.buf.set(data, offset)
    p.got += data.byteLength
    if (p.got < total) return true
    this.parts.delete(key)
    return p.buf
  }

  /** Pieces being assembled. */
  pending(): number {
    return this.parts.size
  }

  drop(key: string): void {
    this.parts.delete(key)
  }

  dropPeer(peer: string): void {
    for (const [k, p] of this.parts) if (p.peer === peer) this.parts.delete(k)
  }
}
