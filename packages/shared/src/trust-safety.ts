/**
 * Trust & Safety and privacy contract: age gate (Lei 15.211/2025), consent records, reports, account enforcement,
 * appeals, account deletion and data export (LGPD art. 18), and the staff-only admin API. Routes are listed in api.ts.
 * Policies behind each rule: docs/trust-safety/README.md.
 */
import { z } from 'zod'

/**
 * Author of messages kept after their account was deleted ("Usuário removido"); render it as such. Only Message.author
 * (REST, events, report snapshots) ever carries it, as a PublicUser (GET /users/:id resolves it too). When the purge
 * runs, open clients get, under the old id: USER_UPDATE with the same "Usuário removido" profile (for what they have
 * cached), MEMBER_REMOVE, RELATIONSHIP_REMOVE, REACTION_REMOVE for each of its reactions and CHANNEL_UPDATE of its DMs
 * without it (a 1:1 DM can be left with only you in recipientIds). Typing, members and recipients never show either id.
 */
export const REMOVED_USER_ID = '00000000-0000-4000-8000-000000000000'

/** Accounts below this age are refused (no guardian linking yet: Lei 15.211/2025, art. 24). */
export const MIN_AGE = 16
export const ADULT_AGE = 18

/**
 * 'teen' = 16–17 (protective defaults: DMs only with friends, no purchases); 'adult' = 18+; 'unknown' = the account
 * predates the age gate: ask once with PATCH /users/@me/birth-date. Under-16 accounts never hold a session.
 */
export type AgeBracket = 'unknown' | 'teen' | 'adult'

/** Today's date in Brazil (YYYY-MM-DD); ages are counted on the Brazilian calendar. */
export const todayInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

/** Whole years between two YYYY-MM-DD dates. */
export function ageOn(birthDate: string, today = todayInBrazil()): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '1900-01-01' && s <= todayInBrazil()
}
/** YYYY-MM-DD, a real calendar date, not in the future. */
export const birthDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.').refine(realDate, 'Data de nascimento inválida.')
/** Version label of the legal bundle (Termos + Política de Privacidade + Diretrizes) the user accepts; see GET /legal. */
export const termsVersion = z.string().trim().min(1).max(64)

export const BirthDateBody = z.object({ birthDate })
export type BirthDateBody = z.infer<typeof BirthDateBody>

export const AcceptTermsBody = z.object({ termsVersion })
export type AcceptTermsBody = z.infer<typeof AcceptTermsBody>

/** GET /legal (public): what the signup screen shows and sends back as RegisterBody.termsVersion. */
export interface LegalInfo {
  termsVersion: string
  termsUrl: string
  privacyUrl: string
  guidelinesUrl: string
  minAge: number
  /** Whether this server requires RegisterBody.birthDate and termsVersion (always true in production). */
  signupRequiresBirthDate: boolean
  /** Short pt-BR "o que mudou" of this termsVersion, for the re-acceptance screen (Me.needsTermsAcceptance). */
  changeSummary?: string
}

/**
 * DELETE /users/@me. `messages`: what happens to the messages you wrote in spaces and DMs. 'anonymize' (default) keeps
 * the text under "Usuário removido" (REMOVED_USER_ID) so other people's conversations stay readable; 'delete' removes
 * them. Attachments, avatar and everything else are deleted either way.
 */
export const DeleteAccountBody = z.object({
  password: z.string().min(1).max(256),
  messages: z.enum(['anonymize', 'delete']).default('anonymize'),
})
export type DeleteAccountBody = z.infer<typeof DeleteAccountBody>

export interface AccountDeletionScheduled {
  /** When the purge runs; logging in before it cancels the deletion (AuthResponse.deletionCanceled). */
  purgeAfter: string
  messages: 'anonymize' | 'delete'
}

export interface DataExportRequested {
  id: string
  /** Same as DataExport.status 'queued'. */
  status: 'pending'
  createdAt: string
}

export type DataExportStatus = 'queued' | 'processing' | 'ready' | 'expired' | 'failed'

/** GET /users/@me/exports (newest first). 'failed': ask again (POST /users/@me/export). */
export interface DataExport {
  id: string
  status: DataExportStatus
  createdAt: string
  /** When the zip is deleted (ready/expired); null before it is built and for failed ones. */
  expiresAt: string | null
  /** ready only: signed link to the zip, short-lived (fetch the list again for a new one); the e-mailed link also works. */
  downloadUrl: string | null
}

// ---- reports --------------------------------------------------------------------------------------------------------

/** Categories of docs/legal/diretrizes-da-comunidade.md. 'csam' = any sexualization of under-18s (highest priority). */
export const REPORT_REASONS = [
  'csam', 'violence', 'non_consensual_intimate', 'self_harm', 'harassment', 'hate', 'sexual_content', 'privacy',
  'scam', 'malware', 'spam', 'impersonation', 'illegal_goods', 'piracy', 'ban_evasion', 'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportTargetType = 'message' | 'user' | 'space'

export const CreateReportBody = z.object({
  targetType: z.enum(['message', 'user', 'space']),
  targetId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
})
export type CreateReportBody = z.infer<typeof CreateReportBody>

/** The reporter only learns that the report was received; the reported person never learns who reported. */
export interface ReportReceipt {
  id: string
  createdAt: string
  /** true: you already had an open report of this target; this is that one (HTTP 200 instead of 201). */
  duplicate: boolean
}

// ---- enforcement and appeals ----------------------------------------------------------------------------------------

export const ACCOUNT_ACTION_REASONS = [...REPORT_REASONS, 'underage'] as const
export type AccountActionReason = (typeof ACCOUNT_ACTION_REASONS)[number]
export type AccountActionType = 'warn' | 'suspend' | 'ban' | 'lift'

/** Days after an action during which it can be appealed. */
export const APPEAL_WINDOW_DAYS = 30

export interface AppealView {
  id: string
  actionId: string
  status: 'open' | 'upheld' | 'rejected'
  createdAt: string
  decidedAt: string | null
}

/** GET /users/@me/actions: platform actions taken on your account (newest first). */
export interface AccountAction {
  id: string
  type: AccountActionType
  reason: AccountActionReason
  /** suspend only. */
  until: string | null
  createdAt: string
  /** null when it can no longer be appealed (or is a 'lift'). */
  appealDeadline: string | null
  appeal: AppealView | null
}

/**
 * In ApiError.error.restriction (403 `forbidden`) when a suspended or banned account logs in (or uses a session that
 * raced the action). `appealToken` (login only, 1 h) authenticates POST /appeals without a session.
 */
export interface AccountRestriction {
  type: 'suspended' | 'banned'
  actionId: string | null
  reason: AccountActionReason
  /** When the action was decided (null with actionId). */
  createdAt: string | null
  until: string | null
  appealDeadline: string | null
  appealStatus: AppealView['status'] | null
  appealToken: string | null
}

/** POST /appeals: with a session (warnings) or with AccountRestriction.appealToken (suspended/banned). */
export const CreateAppealBody = z.object({
  actionId: z.uuid(),
  message: z.string().trim().min(10).max(2000),
  appealToken: z.string().max(512).optional(),
})
export type CreateAppealBody = z.infer<typeof CreateAppealBody>

// ---- staff (admin API; staff roles are granted only by apps/server/scripts/grant-staff.ts) --------------------------

export type StaffRole = 'admin' | 'moderator'

export interface AdminReport {
  id: string
  status: 'open' | 'resolved' | 'dismissed'
  /** Higher = more urgent (csam 100, risk to life 50, rest 10). */
  priority: number
  reason: ReportReason
  details: string
  targetType: ReportTargetType
  targetId: string
  /** Who answers for the target (message author, the user, the space owner). */
  targetUserId: string | null
  spaceId: string | null
  channelId: string | null
  /** Never shown to the reported person. null once the reporter's account is deleted. */
  reporterId: string | null
  /** The target as it was when reported (message text, author, attachments metadata), kept if it is later deleted. */
  snapshot: unknown
  action: ReportAction | null
  staffId: string | null
  staffNote: string | null
  createdAt: string
  resolvedAt: string | null
}

export type ReportAction = 'none' | 'remove_content' | 'warn' | 'suspend' | 'ban'

/** `action` other than 'none' requires status 'resolved'; warn/suspend/ban hit targetUserId with the report's reason. */
export const PatchReportBody = z.object({
  status: z.enum(['resolved', 'dismissed']),
  action: z.enum(['none', 'remove_content', 'warn', 'suspend', 'ban']).default('none'),
  /** suspend only: until when. */
  until: z.iso.datetime().optional(),
  note: z.string().trim().max(2000).optional(),
})
export type PatchReportBody = z.infer<typeof PatchReportBody>

export const AccountActionBody = z.object({
  type: z.enum(['warn', 'suspend', 'ban', 'lift']),
  reason: z.enum(ACCOUNT_ACTION_REASONS),
  until: z.iso.datetime().optional(),
  note: z.string().trim().max(2000).optional(),
})
export type AccountActionBody = z.infer<typeof AccountActionBody>

/** Upheld = the action is lifted (when it is the account's current restriction). */
export const PatchAppealBody = z.object({
  status: z.enum(['upheld', 'rejected']),
  note: z.string().trim().max(2000).optional(),
})
export type PatchAppealBody = z.infer<typeof PatchAppealBody>

export interface AdminAppeal extends AppealView {
  userId: string
  message: string
  action: { type: AccountActionType; reason: AccountActionReason; until: string | null; createdAt: string; reportId: string | null }
  staffNote: string | null
}

/** Legal hold: the account is not purged and its access logs outlive the 6 months (court or authority request, CSAM). */
export const PatchAdminUserBody = z.object({ legalHold: z.boolean() })
export type PatchAdminUserBody = z.infer<typeof PatchAdminUserBody>

export const QuarantineBody = z.object({ reportId: z.uuid().optional(), note: z.string().trim().max(2000).optional() })
export type QuarantineBody = z.infer<typeof QuarantineBody>

/** `receiptConfirmed`: the authority (PF/CNCA) confirmed receipt, so the material is deleted (Decreto 12.880/2026, art. 39, §2). */
export const PatchQuarantineBody = z.object({
  authorityProtocol: z.string().trim().min(1).max(200).optional(),
  receiptConfirmed: z.literal(true).optional(),
})
export type PatchQuarantineBody = z.infer<typeof PatchQuarantineBody>

export interface QuarantinedFile {
  id: string
  attachmentId: string
  messageId: string
  channelId: string
  authorId: string
  filename: string
  contentType: string
  size: number
  /** SHA-256 of the preserved bytes (for the authority report); null until copied. */
  sha256: string | null
  reportId: string | null
  /** null = automatic (csam report). */
  staffId: string | null
  evidenceStored: boolean
  authorityProtocol: string | null
  receiptConfirmedAt: string | null
  purgedAt: string | null
  createdAt: string
}

/** Marco Civil art. 15 record (admin only). */
export interface AccessLogEntry {
  userId: string
  ip: string
  userAgentSha256: string
  /** 'session_use' = first use of the day per IP and app. */
  event: 'login' | 'session_use'
  at: string
}
