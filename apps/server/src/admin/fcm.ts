/**
 * Firebase Cloud Messaging, HTTP v1 (https://firebase.google.com/docs/cloud-messaging/send-message), without the
 * Admin SDK: a service-account JWT (RS256, node:crypto) is exchanged for an OAuth token, cached until 5 min before it
 * expires. FCM is the only path Android keeps alive in Doze for an app that is not running.
 */
import { createSign } from 'node:crypto'

export interface FcmCredentials { projectId: string; clientEmail: string; privateKey: string }

export interface FcmMessage {
  title: string
  body: string
  /** Android notification channel (created by the app, apps/admin-android). */
  channel: string
  data: Record<string, string>
}

/** ok = accepted; gone = the token is dead (uninstalled, rotated): delete it; error = retry later or give up. */
export type FcmResult = 'ok' | 'gone' | 'error'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const b64url = (s: string) => Buffer.from(s).toString('base64url')

/** FCM_SERVICE_ACCOUNT: the service-account JSON from the Firebase console, raw or base64. */
export function parseServiceAccount(raw: string): FcmCredentials {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const j = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string }
  if (!j.project_id || !j.client_email || !j.private_key?.includes('PRIVATE KEY')) throw new Error('not a service-account JSON')
  return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key }
}

export class Fcm {
  private access: { value: string; expiresAt: number } | undefined

  /** http: resolved at call time by default, so a test can stub the global fetch. */
  constructor(private readonly creds: FcmCredentials, private readonly http: typeof fetch = (...a) => fetch(...a)) {}

  get projectId(): string {
    return this.creds.projectId
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt - 5 * 60_000 > Date.now()) return this.access.value
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
      iss: this.creds.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
    }))}`
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(this.creds.privateKey, 'base64url')}`
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`FCM auth HTTP ${res.status}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    this.access = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }

  async send(deviceToken: string, m: FcmMessage): Promise<FcmResult> {
    const res = await this.http(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.creds.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: m.title, body: m.body },
          data: m.data,
          // HIGH: delivered at once even in Doze (the notification is shown, which is what high priority is for).
          android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: m.channel, notification_priority: 'PRIORITY_HIGH', default_sound: true } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return 'ok'
    if (res.status === 404) return 'gone'
    if (res.status === 400) {
      const text = await res.text()
      // A malformed/expired registration token comes back as INVALID_ARGUMENT naming the token field.
      return /UNREGISTERED|registration token/i.test(text) ? 'gone' : 'error'
    }
    if (res.status === 401) this.access = undefined
    return 'error'
  }
}
