// The social timeline (spec §7.3.6): heat of reactions, chapters, "Pular abertura". Pure.

/**
 * The heat map as a smooth silhouette: `points` values 0..1 (max = 1; no reactions = all 0), each a Gaussian-weighted
 * mean of the 10 s buckets around it, so a lone reaction reads as a soft hill rather than a 1 px spike.
 */
export function heatProfile(heat: number[], points: number): number[] {
  const n = heat.length
  if (!n || points < 2) return Array.from({ length: Math.max(0, points) }, () => 0)
  const sigma = Math.max(2.5, (n / points) * 3)
  const reach = Math.ceil(sigma * 3)
  const out: number[] = []
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * (n - 1)
    let v = 0
    for (let k = Math.max(0, Math.floor(x - reach)); k <= Math.min(n - 1, Math.ceil(x + reach)); k++) v += (heat[k] ?? 0) * Math.exp(-(((k - x) / sigma) ** 2))
    out.push(v)
  }
  const max = Math.max(...out)
  return max > 0 ? out.map((v) => v / max) : out.map(() => 0)
}

export interface Chapter { startS: number; title: string }

/** The chapter playing at `t` (the last one started), with its index. */
export function chapterAt(chapters: Chapter[], t: number): { index: number; chapter: Chapter } | null {
  let found: { index: number; chapter: Chapter } | null = null
  chapters.forEach((chapter, index) => {
    if (chapter.startS <= t && (!found || chapter.startS >= found.chapter.startS)) found = { index, chapter }
  })
  return found
}

const INTRO = /^(opening|intro|abertura|op)\b/i

/** "Pular abertura": where the next chapter starts when the current one is the opening, else null. */
export function skipIntroTo(chapters: Chapter[], t: number): number | null {
  const at = chapterAt(chapters, t)
  if (!at || !INTRO.test(at.chapter.title.trim())) return null
  const next = chapters.filter((c) => c.startS > at.chapter.startS).sort((a, b) => a.startS - b.startS)[0]
  return next ? next.startS : null
}

/** Reactions in the bucket of time `t` (the hover card's count). */
export const reactionsAt = (heat: number[], t: number, bucketS = 10): number => heat[Math.floor(t / bucketS)] ?? 0
