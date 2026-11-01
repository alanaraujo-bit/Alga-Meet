/** Legal constants and the age bracket (docs/trust-safety/README.md). */
import { ADULT_AGE, ageOn, type AccountActionReason, type AgeBracket, type ReportReason } from '@alga/shared'
import type { UserRow } from './db/schema.js'

/**
 * Version of the legal bundle (docs/legal: Termos + Política + Diretrizes, published together). Bump it in the release
 * that publishes a relevant change: every account then gets Me.needsTermsAcceptance until it accepts again.
 */
export const TERMS_VERSION = '2026-11-01'

export const ageBracketOf = (u: Pick<UserRow, 'birthDate'>, today?: string): AgeBracket =>
  !u.birthDate ? 'unknown' : ageOn(u.birthDate, today) >= ADULT_AGE ? 'adult' : 'teen'

/** Report queue order: material involving children first, then risk to life or of intimate exposure. */
export const REPORT_PRIORITY: Record<ReportReason, number> = {
  csam: 100, violence: 50, self_harm: 50, non_consensual_intimate: 50,
  harassment: 10, hate: 10, sexual_content: 10, privacy: 10, scam: 10, malware: 10, spam: 10, impersonation: 10,
  illegal_goods: 10, piracy: 10, ban_evasion: 10, other: 10,
}

/** pt-BR names of the categories (the rule of the Diretrizes da Comunidade), used in e-mails and API messages. */
export const REASON_LABELS: Record<AccountActionReason, string> = {
  csam: 'conteúdo que sexualiza menores de 18 anos',
  violence: 'ameaça ou incitação à violência',
  non_consensual_intimate: 'imagem íntima sem consentimento',
  self_harm: 'incentivo à autolesão ou ao suicídio',
  harassment: 'assédio',
  hate: 'discurso de ódio',
  sexual_content: 'conteúdo sexual explícito',
  privacy: 'exposição de dados pessoais',
  scam: 'golpe ou fraude',
  malware: 'vírus ou tentativa de invasão',
  spam: 'spam',
  impersonation: 'fingir ser outra pessoa',
  illegal_goods: 'venda ou promoção de itens ilegais',
  piracy: 'pirataria',
  ban_evasion: 'fuga de moderação',
  other: 'violação dos Termos de Uso ou das Diretrizes da Comunidade',
  underage: 'idade abaixo do mínimo de 16 anos',
}

export const DAY_MS = 24 * 60 * 60 * 1000
/** Grace between DELETE /users/@me and the purge; logging in cancels it. */
export const DELETION_GRACE_MS = 7 * DAY_MS
/** Data export download links and zips. */
export const EXPORT_TTL_MS = 7 * DAY_MS

/** Marco Civil art. 15 (access logs) and the moderation retention of the Política (6 months after the case ends). */
export function sixMonthsBefore(now: Date): Date {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - 6)
  return d
}

/** dd/mm/aaaa in Brasília time. */
export const dateBr = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
