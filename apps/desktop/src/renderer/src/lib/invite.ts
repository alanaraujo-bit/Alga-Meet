// shortcut: public invite domain not decided yet; the join box accepts any URL whose last path segment is the code.
export const INVITE_BASE = 'https://alga.meet/i/'

export const inviteLink = (code: string): string => INVITE_BASE + code

/** Code from "abc123", "alga.meet/i/abc123", "https://…/invite/abc123?x=1" (null if nothing usable). */
export function parseInviteCode(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const path = s.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]!.replace(/\/+$/, '')
  const code = path.split('/').pop() ?? ''
  return /^[A-Za-z0-9_-]{2,64}$/.test(code) ? code : null
}
