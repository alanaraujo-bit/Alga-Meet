/**
 * What a session's user agent tells us (the server stores only that, plus when it started and was last used):
 * "Alga Meet 0.1.0 · Windows", "Chrome 140 · macOS". Windows 10 and 11 send the same frozen "Windows NT 10.0".
 */
export function sessionDevice(ua: string): string {
  const v = (re: RegExp) => re.exec(ua)?.[1]
  const [alga, edge, firefox, chrome] = [v(/AlgaMeet\/([\d.]+)/), v(/Edg\/(\d+)/), v(/Firefox\/(\d+)/), v(/Chrome\/(\d+)/)]
  const app =
    alga ? `Alga Meet ${alga}`
    : /Electron\//.test(ua) ? 'Alga Meet'
    : edge ? `Edge ${edge}`
    : firefox ? `Firefox ${firefox}`
    : chrome ? `Chrome ${chrome}`
    : /node|undici/i.test(ua) ? 'API'
    : null
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return [app, os].filter(Boolean).join(' · ') || ua.slice(0, 48) || 'Dispositivo desconhecido'
}
