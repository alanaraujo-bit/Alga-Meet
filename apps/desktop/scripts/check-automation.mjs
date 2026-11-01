// Proves automation mode: a Playwright-launched app opens off-screen, inactive and out of the taskbar,
// while renderer screenshots still work. Usage: node scripts/check-automation.mjs
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const app = await _electron.launch({ args: ['.', '--profile=automation-check'], cwd: fileURLToPath(new URL('..', import.meta.url)) })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
const state = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return { bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused() }
})
const shot = await win.screenshot()
console.log(JSON.stringify({ ...state, screenshotBytes: shot.length }))
await app.close()
