/**
 * Transactional e-mail. `EmailSender` is the only thing a provider has to implement (one `send`); `Mailer` adds the
 * per-address quota, the link format and fire-and-forget delivery on top of whichever driver the config picks:
 * - `console` (dev; production only with ALGA_ALLOW_CONSOLE_EMAIL=1): writes an .eml per message to EMAIL_OUTBOX_DIR
 *   and logs it (the body, which carries the token, only outside production);
 * - `resend`: Resend's REST API (`POST https://api.resend.com/emails`, RESEND_API_KEY, EMAIL_FROM).
 * Another provider (Postmark, SES, SMTP relay…) = one more class with `send` + a case in `createEmailSender`.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import type { EmailConfig } from './config.js'
import { safeErr } from './errors.js'

export type EmailKind = 'verify_email' | 'account_exists' | 'password_reset'
  | 'enforcement' | 'appeal_decision' | 'account_deletion' | 'data_export'

export interface EmailMessage {
  to: string
  kind: EmailKind
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  /** Resolves once the provider accepted the message; throws otherwise. */
  send(msg: EmailMessage): Promise<void>
}

/** RFC 5322 message with text and HTML alternatives (8bit UTF-8, readable in any editor). */
export function toEml(from: string, msg: EmailMessage, date = new Date()): string {
  const boundary = `alga-${randomBytes(8).toString('hex')}`
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body.replace(/\r?\n/g, '\r\n')}\r\n`
  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString('base64')}?=`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', msg.text) + part('text/html', msg.html) + `--${boundary}--\r\n`,
  ].join('\r\n')
}

export class OutboxSender implements EmailSender {
  constructor(private readonly dir: string, private readonly from: string, private readonly log: FastifyBaseLogger, private readonly showBodies: boolean) {}

  async send(msg: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    // No address in the file name (it ends up in directory listings and logs).
    const file = join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${msg.kind}-${randomBytes(3).toString('hex')}.eml`)
    await writeFile(file, toEml(this.from, msg), { mode: 0o600 })
    // Links carry single-use tokens: production logs only say that a message exists.
    if (this.showBodies) this.log.info({ to: msg.to, subject: msg.subject, file, text: msg.text }, 'e-mail written to the outbox (console driver)')
    else this.log.info({ kind: msg.kind, file }, 'e-mail written to the outbox (console driver)')
  }
}

export class ResendSender implements EmailSender {
  static readonly URL = 'https://api.resend.com/emails'

  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch(ResendSender.URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    })
    // Resend's error bodies are { statusCode, name, message } about the request, never the key.
    if (!res.ok) throw new Error(`resend: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
  }
}

export function createEmailSender(config: EmailConfig, log: FastifyBaseLogger, production: boolean): EmailSender {
  return config.driver === 'resend'
    ? new ResendSender(config.apiKey, config.from)
    : new OutboxSender(config.outboxDir, config.from, log, !production)
}

/**
 * Sliding-window count per key. shortcut: process memory, like the rate limits (one instance); with several, move it
 * to Redis together with the @fastify/rate-limit store.
 */
class Quota {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly max: number, private readonly windowMs: number) {}

  take(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs
    if (this.hits.size > 10_000) for (const [k, t] of this.hits) if (t.at(-1)! <= since) this.hits.delete(k)
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since)
    if (recent.length >= this.max) return false
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}

export const MAILS_PER_ADDRESS_PER_HOUR = 3

export class Mailer {
  private readonly quota = new Quota(MAILS_PER_ADDRESS_PER_HOUR, 60 * 60 * 1000)

  constructor(readonly sender: EmailSender, private readonly log: FastifyBaseLogger, private readonly linkUrl: string) {}

  /**
   * Claims one of the address's mails of this flow for the hour; false = drop silently (same response either way).
   * Checked before issuing a token, so flooding requests can neither fill an inbox nor keep invalidating the link
   * the owner already received.
   */
  reserve(flow: 'verify' | 'reset', to: string): boolean {
    return this.quota.take(`${flow}:${to}`)
  }

  /** Link opened from the e-mail: the app (deep link or page at EMAIL_LINK_URL) posts the token to the API. */
  link(action: 'verify-email' | 'reset-password', token: string): string {
    return `${this.linkUrl}/${action}?token=${token}`
  }

  /** Fire-and-forget: a request never waits for, or fails because of, the provider. Failures are logged. */
  send(msg: EmailMessage): void {
    void this.sender.send(msg).catch((err: unknown) => this.log.error({ err: safeErr(err), kind: msg.kind }, 'e-mail not sent'))
  }
}
