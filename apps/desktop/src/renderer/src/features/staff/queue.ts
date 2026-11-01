import { REMOVED_USER_ID, type AdminReport, type PatchReportBody, type PublicUser, type ReportAction } from '@alga/shared'

/** One attachment of a reported message, as metadata only: the snapshot's (expired) URL is dropped on purpose. */
export interface SnapAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  width?: number
  height?: number
}

/** What was reported, as it was at report time (the target may be gone or edited since). */
export type Target =
  | {
      kind: 'message'
      content: string
      author: PublicUser | null
      createdAt: string | null
      edited: boolean
      channelName: string
      dm: boolean
      attachments: SnapAttachment[]
    }
  | { kind: 'user'; user: PublicUser | null }
  | {
      kind: 'space'
      name: string
      memberCount: number | null
      createdAt: string | null
    }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const user = (v: unknown): PublicUser | null => {
  const u = obj(v)
  return str(u.id) && str(u.username) ? (u as unknown as PublicUser) : null
}

/** AdminReport.snapshot is `unknown` on the wire: read it defensively, and never keep a media URL from it. */
export function readTarget(r: Pick<AdminReport, 'targetType' | 'snapshot'>): Target {
  const s = obj(r.snapshot)
  if (r.targetType === 'user') return { kind: 'user', user: user(s.user) }
  if (r.targetType === 'space') {
    const sp = obj(s.space)
    return {
      kind: 'space',
      name: str(sp.name) ?? '',
      memberCount: num(sp.memberCount),
      createdAt: str(sp.createdAt),
    }
  }
  const ch = obj(s.channel)
  const files = Array.isArray(s.attachments) ? s.attachments : []
  return {
    kind: 'message',
    content: str(s.content) ?? '',
    author: user(s.author),
    createdAt: str(s.createdAt),
    edited: !!str(s.editedAt),
    channelName: str(ch.name) ?? '',
    dm: ch.type === 'dm' || ch.type === 'group_dm',
    attachments: files.flatMap((f) => {
      const a = obj(f)
      const id = str(a.id)
      if (!id) return []
      const out: SnapAttachment = {
        id,
        filename: str(a.filename) ?? '',
        contentType: str(a.contentType) ?? '',
        size: num(a.size) ?? 0,
      }
      const w = num(a.width)
      const h = num(a.height)
      if (w && h) Object.assign(out, { width: w, height: h })
      return [out]
    }),
  }
}

/** csam first (the server sorts by priority), then risk to life, then the rest. */
export type Tier = 'csam' | 'urgent' | 'normal'
export const tierOf = (r: Pick<AdminReport, 'reason' | 'priority'>): Tier => (r.reason === 'csam' ? 'csam' : r.priority >= 50 ? 'urgent' : 'normal')

/** A decision on an open report: dismiss (unfounded) or resolve with an action. */
export type Decision = 'dismiss' | ReportAction

/** Single-letter shortcuts (pt-BR mnemonics). Every one opens a confirmation; nothing is applied by the key alone. */
export const REPORT_KEYS: Record<string, Decision> = {
  a: 'dismiss',
  n: 'none',
  c: 'remove_content',
  v: 'warn',
  s: 'suspend',
  b: 'ban',
}
export const APPEAL_KEYS: Record<string, 'rejected' | 'upheld'> = {
  m: 'rejected',
  r: 'upheld',
}
export const QUARANTINE_KEYS: Record<string, 'release'> = { l: 'release' }
export const keyFor = <T extends string>(map: Record<string, T>, v: T): string =>
  Object.keys(map)
    .find((k) => map[k] === v)!
    .toUpperCase()

/** Why a decision cannot apply to this report (the server would refuse it), or null. */
export function unavailable(r: Pick<AdminReport, 'targetType' | 'targetUserId'>, d: Decision): 'profile' | 'gone' | null {
  if (d === 'remove_content') return r.targetType === 'user' ? 'profile' : null
  if (d === 'warn' || d === 'suspend' || d === 'ban') return !r.targetUserId || r.targetUserId === REMOVED_USER_ID ? 'gone' : null
  return null
}

export const SUSPEND_DAYS = [1, 3, 7, 30] as const
export type SuspendDays = (typeof SUSPEND_DAYS)[number]

export function decisionBody(d: Decision, opts: { days?: SuspendDays; note?: string; now?: number } = {}): PatchReportBody {
  const note = opts.note?.trim() || undefined
  if (d === 'dismiss') return { status: 'dismissed', action: 'none', note }
  const until = d === 'suspend' ? new Date((opts.now ?? Date.now()) + (opts.days ?? 7) * 86_400_000).toISOString() : undefined
  return { status: 'resolved', action: d, until, note }
}

/** Next/previous index for ↑↓ / j k, clamped (no wrap: the end of a queue is a place). */
export const step = (i: number, n: number, dir: 1 | -1): number => (n === 0 ? -1 : Math.min(n - 1, Math.max(0, i + dir)))
