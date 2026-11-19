// Pure helpers of the web bridge (tested in logic.test.ts).
import { parseDeepLink } from '../main/deep-link-logic'
import type { DeepLink } from '../shared/bridge'

/**
 * The link the PWA was opened with: /i/<code>, /auth/verify-email?token=…, /auth/reset-password?token=…; else null.
 * Mapped onto the desktop's algameet:// allowlist so both accept exactly the same links.
 */
export function parseWebLink(pathname: string, search: string): DeepLink | null {
  const path = pathname.startsWith('/i/') ? '/invite/' + pathname.slice(3) : pathname
  return parseDeepLink('algameet:/' + path + search)
}

/** Friendly OS name for X-Alga-Client, from the user agent ("Android 15", "iOS 18", "Windows", …). */
export function webOsLabel(ua: string): string {
  const android = /Android (\d+)/.exec(ua)
  if (android) return `Android ${android[1]}`
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+)/.exec(ua)
  if (ios) return `iOS ${ios[1]}`
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Web'
}
