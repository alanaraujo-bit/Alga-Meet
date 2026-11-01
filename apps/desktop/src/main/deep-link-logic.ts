import type { DeepLink } from '../shared/bridge'

// Strict allowlist of the algameet:// links the app accepts; everything else is rejected.
// Matched on the raw string (no URL normalisation: "invite/../x", %-escapes, extra params all fail).
//   algameet://auth/verify-email?token=<t>     (server: Mailer.link, EMAIL_LINK_URL=algameet://auth)
//   algameet://auth/reset-password?token=<t>
//   algameet://invite/<code>
// Tokens are 32 random bytes in base64url (43 chars); the server refuses anything over 128.
// Invite codes follow the server's codeParam rule (1-32 base62 chars; it issues 8).
// Case-sensitive (the server emits lowercase). One trailing slash before the end/query is tolerated:
// some Windows launchers append it.
const AUTH = /^algameet:\/\/auth\/(verify-email|reset-password)\/?\?token=([A-Za-z0-9_-]{16,128})$/
const INVITE = /^algameet:\/\/invite\/([0-9A-Za-z]{1,32})\/?$/
const MAX_LEN = 512

export function parseDeepLink(raw: unknown): DeepLink | null {
  if (typeof raw !== 'string' || raw.length > MAX_LEN) return null
  const auth = AUTH.exec(raw)
  if (auth) return { kind: auth[1] === 'verify-email' ? 'verify-email' : 'password-reset', token: auth[2]! }
  const invite = INVITE.exec(raw)
  return invite ? { kind: 'invite', code: invite[1]! } : null
}

/** An argv entry that claims to be one of our links (validated by parseDeepLink). */
export const isDeepLinkArg = (a: unknown): a is string => typeof a === 'string' && a.slice(0, 9).toLowerCase() === 'algameet:'

export function findDeepLinkArg(argv: readonly string[]): string | undefined {
  return argv.find(isDeepLinkArg)
}

/** Loggable form of a rejected link: scheme + host only, never the path/query that may carry a secret. */
export function redactLink(raw: string): string {
  const head = /^[a-z][a-z0-9+.-]{0,31}:(\/\/[^/?#\\]{0,32})?/i.exec(raw)?.[0] ?? '?'
  return `${head} (${raw.length} chars)`
}
