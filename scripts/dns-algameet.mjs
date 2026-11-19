// DNS of algameet.com (Hostinger) for the Railway services: site (apex), app (PWA), api. Reads the Hostinger API
// token from %USERPROFILE%\.alga\hostinger.token (never printed). Saves the current zone first, validates, then writes.
//   node scripts/dns-algameet.mjs            dry run: shows the current zone and what would change
//   node scripts/dns-algameet.mjs --apply    writes the records
// The values come from Railway (generate-domain on each service); docs/infra/domains.md lists them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DOMAIN = 'algameet.com'
const API = 'https://developers.hostinger.com/api/dns/v1/zones/' + DOMAIN
const TTL = 300
const RECORDS = [
  { name: '@', type: 'ALIAS', content: 'zzdby9jt.up.railway.app.' },
  { name: '_railway-verify', type: 'TXT', content: 'railway-verify=5af6f2ad5119cf49d8e7fe2e78173d3e7342b4f884ca8a9a0707302ddd054f27' },
  { name: 'app', type: 'CNAME', content: 'labn6y17.up.railway.app.' },
  { name: '_railway-verify.app', type: 'TXT', content: 'railway-verify=7aeb51268bf55de226c53ae7d83d1526ada106cd77a6637c9392bb24226140fa' },
  { name: 'api', type: 'CNAME', content: 'fvrbql08.up.railway.app.' },
  { name: '_railway-verify.api', type: 'TXT', content: 'railway-verify=2ce8698661fe02d92e887af8947e08e235c8188d83439c9ef94cd1643398ea3d' },
]

const token = readFileSync(join(homedir(), '.alga', 'hostinger.token'), 'utf8').trim()
if (!/^[\w.|-]{20,}$/.test(token)) throw new Error('hostinger.token does not look like a token (expected the token alone, one line)')
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }
async function call(method, url, body) {
  const r = await fetch(url, { method, headers, body: body && JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '<zone>')} → ${r.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

const current = await call('GET', API)
const backupDir = join(homedir(), '.alga')
mkdirSync(backupDir, { recursive: true })
const backup = join(backupDir, `dns-${DOMAIN}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(backup, JSON.stringify(current, null, 2))
console.log(`current zone saved to ${backup}`)
for (const r of current) console.log(`  now  ${r.type.padEnd(5)} ${r.name.padEnd(22)} ${r.records.map((x) => x.content).join(', ')}`)

// The parking page's records at the apex (A/AAAA/CNAME at @, www) go: an ALIAS cannot sit next to them.
const stale = current.filter((r) => (r.name === '@' && ['A', 'AAAA', 'CNAME'].includes(r.type)) || (r.name === 'www' && ['A', 'AAAA', 'CNAME'].includes(r.type)))
const zone = RECORDS.map((r) => ({ name: r.name, type: r.type, ttl: TTL, records: [{ content: r.content }] }))
for (const r of stale) console.log(`  drop ${r.type.padEnd(5)} ${r.name.padEnd(22)} ${r.records.map((x) => x.content).join(', ')}`)
for (const r of RECORDS) console.log(`  set  ${r.type.padEnd(5)} ${r.name.padEnd(22)} ${r.content}`)

if (!process.argv.includes('--apply')) {
  // Dry run: the parking records may still clash with the ALIAS here; --apply drops them before validating.
  await call('POST', `${API}/validate`, { overwrite: true, zone }).then(() => console.log('validated by Hostinger'), (e) => console.log(`validation (before dropping the parking records): ${e.message}`))
  process.exit(0)
}
if (stale.length) await call('DELETE', API, { filters: stale.map((r) => ({ name: r.name, type: r.type })) })
await call('POST', `${API}/validate`, { overwrite: true, zone })
await call('PUT', API, { overwrite: true, zone })
console.log('written; the old zone is in the backup above')
