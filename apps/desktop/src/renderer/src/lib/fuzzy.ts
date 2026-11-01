/** Accent/case-insensitive fold so "joao" finds "João". */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Subsequence score for the quick switcher; null = no match.
 * Rewards prefix, word starts and consecutive runs; shorter targets win ties.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = fold(query.trim())
  if (!q) return 0
  const t = fold(target)
  if (t.startsWith(q)) return 1000 - t.length
  const sub = t.indexOf(q)
  if (sub >= 0) return 700 - sub - t.length + (/[\s\-_#@.]/.test(t[sub - 1] ?? '') ? 100 : 0)
  let score = 0
  let ti = 0
  let run = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    run = at === ti ? run + 1 : 0
    score += 10 + run * 5 + (at === 0 || /[\s\-_#@.]/.test(t[at - 1]!) ? 15 : 0) - (at - ti)
    ti = at + 1
  }
  return score - t.length * 0.5
}

/** Highlight ranges [start, end) of `query` in `target` (same folding as fuzzyScore), for the quick switcher. */
export function matchRanges(query: string, target: string): Array<[number, number]> {
  const q = fold(query.trim())
  const t = fold(target)
  // Folding changed the length (decomposed input): skip highlighting rather than mark the wrong letters.
  if (!q || t.length !== target.length) return []
  const at = t.indexOf(q)
  if (at >= 0) return [[at, at + q.length]]
  const out: Array<[number, number]> = []
  let ti = 0
  for (const ch of q) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return []
    const last = out[out.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else out.push([i, i + 1])
    ti = i + 1
  }
  return out
}
