/**
 * Coarse device labels for GET /auth/sessions, so a user can tell their sessions apart. From the X-Alga-Client header
 * (api.ts) when the desktop sent it, else a few well-known User-Agent tokens. Never versions from the User-Agent and no
 * IP geolocation: the label must not say more about the device than the user needs to recognize it.
 */

export const MAX_ALGA_CLIENT_LENGTH = 96
const ALGA_CLIENT = /^(\d{1,4}(?:\.\d{1,4}){0,3}(?:-[0-9A-Za-z.]{1,24})?)\s*;\s*([A-Za-z0-9 ._()-]{1,48})$/

/** X-Alga-Client normalized to "<version>; <os>", or null when absent or invalid (ignored, never an error). */
export function algaClientHeader(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_ALGA_CLIENT_LENGTH) return null
  const m = ALGA_CLIENT.exec(v.trim())
  return m ? `${m[1]}; ${m[2]}` : null
}

const UA_CLIENTS: [RegExp, string][] = [[/Edg\//, 'Edge'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Version\/[\d.]+ .*Safari\//, 'Safari']]
// Order matters: Android UAs contain "Linux", iOS ones "like Mac OS X". Windows 10 and 11 share "Windows NT 10.0".
const UA_OSES: [RegExp, string][] = [[/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad|iPod/, 'iOS'], [/Mac OS X/, 'macOS'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux']]

export function sessionDevice(userAgent: string, clientInfo: string | null): { client: string | null; os: string | null } {
  if (clientInfo) {
    const [version, os] = clientInfo.split('; ') // stored only after algaClientHeader
    return { client: `Alga Meet ${version}`, os: os ?? null }
  }
  // Electron's default User-Agent carries "AlgaMeet/<version>" (productName without spaces).
  const app = /Alga ?Meet\/(\d{1,4}(?:\.\d{1,4}){0,3})/i.exec(userAgent)
  return {
    client: app ? `Alga Meet ${app[1]}` : (UA_CLIENTS.find(([re]) => re.test(userAgent))?.[1] ?? null),
    os: UA_OSES.find(([re]) => re.test(userAgent))?.[1] ?? null,
  }
}
