import { compareVersions, type ReleaseItem, type ReleaseNote } from '@alga/shared'

/** What this person has already seen on this PC (localStorage, per account). */
export interface SeenState {
  /** Highest version whose welcome was closed; null = this PC never closed one (first run with Novidades). */
  lastSeen: string | null
  /** Versions already looked at (welcome closed or opened in the center): they lose the "Novo" mark. */
  viewed: string[]
  /** "Lembrar depois": no welcome before this epoch ms. */
  snoozeUntil: number
}

export const SNOOZE_MS = 24 * 60 * 60 * 1000
/** Somebody who skipped many versions gets the latest few in the welcome; the center has the rest. */
export const MAX_WELCOME_VERSIONS = 4
export const MAX_WELCOME_HIGHLIGHTS = 6

/**
 * First run with Novidades on this PC. A new account (made in the last day) starts with everything seen: nobody
 * needs "what changed" on their first day. Anyone else gets the welcome for the version they are on, and the
 * versions before it are history, not news.
 */
export function initialSeen(notes: ReleaseNote[], installed: string, newAccount: boolean): SeenState {
  const before = notes.filter((n) => compareVersions(n.version, installed) < 0).map((n) => n.version)
  return newAccount
    ? { lastSeen: installed, viewed: [...before, ...notes.filter((n) => n.version === installed).map((n) => n.version)], snoozeUntil: 0 }
    : { lastSeen: null, viewed: before, snoozeUntil: 0 }
}

/**
 * Notes the welcome should present, newest first: every published version after the last one closed, up to the one
 * installed (several when versions were skipped). Without a last one, only the installed version. A downgrade or an
 * already-seen version gives nothing.
 */
export function pendingNotes(notes: ReleaseNote[], installed: string, seen: SeenState): ReleaseNote[] {
  return notes
    .filter((n) => compareVersions(n.version, installed) <= 0)
    .filter((n) => (seen.lastSeen === null ? n.version === installed : compareVersions(n.version, seen.lastSeen) > 0))
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, MAX_WELCOME_VERSIONS)
}

export interface Highlight {
  version: string
  item: ReleaseItem
}

/** The welcome's cards: highlighted items newest version first; a version without highlights lends its first item. */
export function highlightsOf(notes: ReleaseNote[]): Highlight[] {
  const out: Highlight[] = []
  for (const n of notes) {
    const hi = n.content.items.filter((i) => i.highlight)
    for (const item of hi.length ? hi : n.content.items.slice(0, 1)) out.push({ version: n.version, item })
  }
  return out.slice(0, MAX_WELCOME_HIGHLIGHTS)
}

/** After the welcome closes ("Entendi", ×, Esc): the newest presented version becomes the last seen. */
export function closeWelcome(seen: SeenState, shown: ReleaseNote[]): SeenState {
  const top = shown.map((n) => n.version).sort(compareVersions).at(-1)
  if (!top) return seen
  const lastSeen = seen.lastSeen && compareVersions(seen.lastSeen, top) > 0 ? seen.lastSeen : top
  return { lastSeen, viewed: [...new Set([...seen.viewed, ...shown.map((n) => n.version)])], snoozeUntil: 0 }
}

export const markViewed = (seen: SeenState, version: string): SeenState =>
  seen.viewed.includes(version) ? seen : { ...seen, viewed: [...seen.viewed, version] }

/** Versions that still carry "Novo" (the rail dot is on while there is one). */
export const unviewed = (notes: ReleaseNote[], seen: SeenState): string[] =>
  notes.filter((n) => !seen.viewed.includes(n.version)).map((n) => n.version)

/** What would make a welcome an interruption right now. */
export interface Moment {
  /** Connecting to, in, or rejoining a call (covers screen sharing and the cinema, both need a call). */
  inCall: boolean
  /** A game detected in the foreground (rich presence). */
  gaming: boolean
  /** Settings, a dialog, the switcher, the staff panel, onboarding… already on screen. */
  overlay: boolean
  /** The window is visible and focused: nobody is shown a modal they cannot see. */
  attentive: boolean
}

export const isQuiet = (m: Moment): boolean => !m.inCall && !m.gaming && !m.overlay && m.attentive

export const shouldWelcome = (pending: ReleaseNote[], seen: SeenState, moment: Moment, now: number): boolean =>
  pending.length > 0 && seen.snoozeUntil <= now && isQuiet(moment)

/** Parses what localStorage holds; anything malformed is treated as "never seen" (null). */
export function readSeen(raw: string | null): SeenState | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<SeenState> | null
    if (!v || typeof v !== 'object') return null
    const lastSeen = typeof v.lastSeen === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.lastSeen) ? v.lastSeen : null
    const viewed = Array.isArray(v.viewed) ? v.viewed.filter((x): x is string => typeof x === 'string').slice(-200) : []
    const snoozeUntil = typeof v.snoozeUntil === 'number' && Number.isFinite(v.snoozeUntil) ? v.snoozeUntil : 0
    return { lastSeen, viewed, snoozeUntil }
  } catch {
    return null
  }
}
