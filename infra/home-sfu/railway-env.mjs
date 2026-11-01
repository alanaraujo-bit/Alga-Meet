// Turns `railway variables --json` (stdin) into the .env lines the home SFU needs (stdout), so the LiveKit secret
// goes from Railway to the server without ever being shown. Usage (README §4), from the repo root:
//   railway variables -s api -e staging --json | node infra/home-sfu/railway-env.mjs | ssh <user>@<server> "umask 077; mkdir -p ~/alga-sfu; cat > ~/alga-sfu/.env"
let raw = ''
process.stdin.on('data', (d) => (raw += d)).on('end', () => {
  const fail = (msg) => { console.error(`railway-env: ${msg}`); process.exit(1) }
  if (process.stdout.isTTY) fail('stdout is a terminal; pipe it into ssh/a file so the secret is not printed')
  let v
  try { v = JSON.parse(raw) } catch { fail('stdin is not JSON (did `railway variables --json` fail? run `railway link`)') }
  const key = v.LIVEKIT_API_KEY, secret = v.LIVEKIT_API_SECRET
  if (!key || !secret) fail('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set on this Railway service')
  if (key === 'devkey' || secret.length < 32) fail('refusing the dev key pair or a secret shorter than 32 characters')
  const api = v.PUBLIC_URL || (v.RAILWAY_PUBLIC_DOMAIN && `https://${v.RAILWAY_PUBLIC_DOMAIN}`)
  if (!api) fail('neither PUBLIC_URL nor RAILWAY_PUBLIC_DOMAIN is set; add ALGA_API_URL to .env by hand')
  process.stdout.write(`LIVEKIT_API_KEY=${key}\nLIVEKIT_API_SECRET=${secret}\nALGA_API_URL=${api.replace(/\/+$/, '')}\n`)
  console.error(`railway-env: wrote LIVEKIT_API_KEY=${key}, LIVEKIT_API_SECRET=(hidden), ALGA_API_URL=${api}`)
})
