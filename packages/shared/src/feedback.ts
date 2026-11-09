/**
 * App feedback ("Conta pro Eco"): a person tells the team about a bug, a freeze, an idea or praise from a small card in
 * the desktop app. The app sends along what the team would otherwise have to ask (app version and OS in the
 * X-Alga-Client header, a closed context, optionally the recent app log and one screenshot). Private to the sender
 * and the team; stored for a future admin panel (docs/feedback.md). The anonymous uninstall question is separate
 * (UninstallFeedbackBody in api.ts).
 */
import { z } from 'zod'

export const FEEDBACK_KINDS = ['bug', 'crash', 'idea', 'praise'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_TEXT_MAX = 2000
export const FEEDBACK_LOG_MAX_LINES = 200
export const FEEDBACK_LOG_MAX_BYTES = 48 * 1024
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024
export const FEEDBACK_PER_HOUR = 10

/**
 * How the previous session ended when the feedback comes from the "Travei da última vez" offer: the interface process
 * died, or the window stopped answering and never came back.
 */
export const FEEDBACK_CRASH_KINDS = ['renderer', 'unresponsive'] as const
export type FeedbackCrashKind = (typeof FEEDBACK_CRASH_KINDS)[number]

/** Where the person was. Closed on purpose (`.strict()`): never a name or an id of a space, channel or person. */
export const FeedbackContext = z.object({
  view: z.enum(['home', 'dm', 'space']),
  inCall: z.boolean(),
  sharing: z.boolean(),
  cinema: z.boolean(),
  crash: z.enum(FEEDBACK_CRASH_KINDS).nullable(),
}).strict()
export type FeedbackContext = z.infer<typeof FeedbackContext>

/** The multipart text fields of POST /feedback, after `context` is JSON-parsed. */
export const FeedbackFields = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  text: z.string().trim().min(1, 'Escreva alguma coisa.').max(FEEDBACK_TEXT_MAX, `Use até ${FEEDBACK_TEXT_MAX} caracteres.`),
  context: FeedbackContext,
  log: z.string().max(FEEDBACK_LOG_MAX_BYTES).optional(),
})
export type FeedbackFields = z.infer<typeof FeedbackFields>

/** The log only helps (and only goes) when something went wrong. */
export const kindTakesLog = (k: FeedbackKind): boolean => k === 'bug' || k === 'crash'

/** What the sender gets back and sees in "Seus envios". */
export interface FeedbackItem {
  id: string
  kind: FeedbackKind
  text: string
  createdAt: string
  hasScreenshot: boolean
}
