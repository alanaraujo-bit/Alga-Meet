// Launches an installed Alga Meet build and reports which API it targets + a screenshot.
// Usage: node scripts/check-installed.mjs "<path to Alga Meet.exe>" <screenshot.png>
import { _electron } from 'playwright'

const [exe, shot] = process.argv.slice(2)
const app = await _electron.launch({ executablePath: exe, args: ['--profile=installed-check'] })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(4000)
const cfg = await win.evaluate(() => window.alga?.config)
const text = (await win.textContent('body'))?.replace(/\s+/g, ' ').slice(0, 160)
if (shot) await win.screenshot({ path: shot })
console.log(JSON.stringify({ apiUrl: cfg?.apiUrl, isPackaged: cfg?.isPackaged, version: cfg?.version, text }))
await app.close()
