/**
 * Pure rules of the feedback card ("Conta pro Eco", docs/feedback.md): the draft that survives closing, what goes
 * along with each kind, and when the app may offer the card by itself after a crash.
 */
import { FEEDBACK_KINDS, FEEDBACK_TEXT_MAX, kindTakesLog, type FeedbackContext, type FeedbackCrashKind, type FeedbackKind } from '@alga/shared'
import type { EcoState } from '@/ui/eco/ecoRules'
import { isQuiet, type Moment } from '../whatsnew/logic'

/** How the previous session ended (window.alga.app.takeCrash). */
export interface Crash {
  kind: FeedbackCrashKind
  at: number
  version: string
}

export interface Draft {
  kind: FeedbackKind
  text: string
}
export const EMPTY_DRAFT: Draft = { kind: 'idea', text: '' }
export const draftKey = (userId: string): string => `alga.feedback.draft.v1.${userId}`

/** Parses what localStorage holds; anything malformed is an empty draft. */
export function readDraft(raw: string | null): Draft {
  try {
    const v = JSON.parse(raw ?? 'null') as { kind?: unknown; text?: unknown } | null
    if (v && (FEEDBACK_KINDS as readonly unknown[]).includes(v.kind) && typeof v.text === 'string' && v.text.length <= FEEDBACK_TEXT_MAX) {
      return { kind: v.kind as FeedbackKind, text: v.text }
    }
  } catch {}
  return EMPTY_DRAFT
}

/** Same rule as the server (FeedbackFields.text). */
export const canSend = (text: string): boolean => {
  const n = text.trim().length
  return n >= 1 && n <= FEEDBACK_TEXT_MAX
}

export const sendsLog = (kind: FeedbackKind, logOn: boolean): boolean => logOn && kindTakesLog(kind)

/** Where the person is, in the closed shape the server accepts: kinds and flags, never a name or an id. */
export function contextOf(a: { view: FeedbackContext['view']; inCall: boolean; sharing: boolean; cinema: boolean; crash: Crash | null }): FeedbackContext {
  return { view: a.view, inCall: a.inCall, sharing: a.sharing, cinema: a.cinema, crash: a.crash?.kind ?? null }
}

/** "Travei da última vez": only in a quiet moment, and never on top of the Novidades welcome (it goes first). */
export const shouldOfferCrash = (crash: Crash | null, moment: Moment, welcomeOpen: boolean): boolean =>
  crash !== null && !welcomeOpen && isQuiet(moment)

/** The light, the Eco's outline and the focus ring follow the kind (design-system semantic tokens, as hex for the Eco). */
export const KIND_TONE: Record<FeedbackKind, string> = { bug: '#e66e68', crash: '#e6b463', idea: '#8b8ef7', praise: '#61c28e' }
/** How the Eco reacts when a kind is picked. */
export const KIND_ECO: Record<FeedbackKind, EcoState> = { bug: 'listening', crash: 'error', idea: 'success', praise: 'success' }

export const firstName = (displayName: string): string => displayName.trim().split(/\s+/)[0] ?? ''
