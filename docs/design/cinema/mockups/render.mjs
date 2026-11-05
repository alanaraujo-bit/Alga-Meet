// Renders the mockups to PNG: node docs/design/cinema/mockups/render.mjs [01 02 ...]
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const SCREENS = [
  '01-chamada-cartao', '02-ficha', '03-foyer', '04-foyer-vazio', '05-assistindo-ui', '06-assistindo-limpo',
  '07-pausa', '08-esperando', '09-intervalo', '10-proximo-episodio', '11-canhoto',
]
const only = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
for (const name of SCREENS.filter((s) => !only.length || only.some((o) => s.startsWith(o)))) {
  const url = `${pathToFileURL(join(here, 'index.html')).href}?screen=${name}`
  await page.goto(url)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(here, 'png', `${name}.png`) })
  console.log('png/' + name + '.png')
}
await browser.close()
