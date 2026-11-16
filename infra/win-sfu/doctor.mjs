// Health report of the Windows-native SFU. Changes nothing, needs no admin, prints no secrets (it cannot even read
// .env: it works from run\state.json, which the supervisor writes).
//   node infra/win-sfu/doctor.mjs            (finds C:\ProgramData\AlgaMeetSFU)
//   node doctor.mjs --dir <folder>           (another install folder, e.g. a local test)
// Everything is tested from this PC; the outside test (phone on 4G/5G) is README §6.
import { execFileSync } from 'node:child_process'
import dnsp from 'node:dns/promises'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PORTS, SIGNAL_PORT, findIgd, findMapping, gatewayIPv4, isPrivate, lanIPv4, listMappings, publicIPv4, routerWanIp, stunProbe } from './lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = process.argv.indexOf('--dir')
const DIR = arg > 0 ? path.resolve(process.argv[arg + 1]) : fs.existsSync(path.join(here, 'run', 'state.json')) ? here : 'C:\\ProgramData\\AlgaMeetSFU'
const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (c, s) => (color ? `\x1b[${c}m${s}\x1b[0m` : s)
let fails = 0
const pass = (m) => console.log(`  ${paint(32, 'OK')}    ${m}`)
const warn = (m) => console.log(`  ${paint(33, 'AVISO')} ${m}`)
const fail = (m) => { fails++; console.log(`  ${paint(31, 'FALHA')} ${m}`) }
const info = (m) => console.log(`  ${m}`)
// EPERM = the process exists but belongs to another account: the installed SFU runs as LocalService and this
// script as the owner, so "not allowed to signal it" is the normal answer for a live process.
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

let st = null
try { st = JSON.parse(fs.readFileSync(path.join(DIR, 'run', 'state.json'), 'utf8')) } catch {}

console.log('== Rede')
const lan = await lanIPv4()
const gw = gatewayIPv4(lan)
info(`IP na rede local: ${lan ?? '?'}  roteador: ${gw ?? '?'}`)
const pub = await publicIPv4()
if (pub) info(`IPv4 público (visto de fora): ${pub}`); else fail('sem IPv4 de saída para a internet')
const igd = await findIgd(lan, gw)
const wan = igd ? await routerWanIp(igd) : null
if (!wan) warn(`o roteador não respondeu por UPnP: compare o IP WAN na página do roteador com ${pub}`)
else if (isPrivate(wan)) fail(`IP WAN do roteador ${wan} é privado/CGNAT: ninguém de fora alcança esta casa`)
else if (wan !== pub) fail(`IP WAN do roteador ${wan} != IP público ${pub}: NAT duplo ou CGNAT`)
else pass(`sem CGNAT: IP WAN do roteador = IP público (${wan})`)

if (!st) {
  console.log(`\nSem ${path.join(DIR, 'run', 'state.json')}: o SFU ainda não foi instalado neste PC (README §3). Só a rede foi conferida.`)
  process.exit(fails ? 1 : 0)
}
const { domain, dryRun } = st
if (dryRun) warn('DRY_RUN=1: instalação de teste, sem DuckDNS, sem UPnP e com certificado de teste')

console.log(`== DNS (${domain})`)
if (dryRun) info('pulado em DRY_RUN')
else {
  const a = await dnsp.resolve4(domain).then((r) => r[0], () => null)
  if (a && a === pub) pass(`A ${a} = IP público`); else fail(`A ${a ?? 'ausente'} != IP público ${pub ?? '?'} (veja logs\\sfu.log, linhas "duckdns:")`)
  const d = st.duckdns ?? {}
  if (d.skipped) warn('sem DUCKDNS_TOKEN no .env: ninguém atualiza o DNS. Quando o IP público mudar (queda de luz, reinício do modem), a voz cai até pôr o token')
  else if (d.ok) pass(`última atualização do DuckDNS: ${d.at} (${d.result})`); else fail(`DuckDNS: ${d.result ?? 'nenhuma atualização ainda'}`)
}

console.log('== Processos')
const age = (Date.now() - Date.parse(st.savedAt ?? 0)) / 1000
if (alive(st.pid) && age < 120) pass(`supervisor de pé desde ${st.startedAt} (pid ${st.pid})`)
else fail(`supervisor parado (último sinal há ${Math.round(age)} s). Tarefa agendada "AlgaMeetSFU": inicie pelo Agendador de Tarefas ou rode install.ps1 de novo`)
for (const name of ['livekit', 'caddy']) {
  const p = st[name] ?? {}
  if (p.pid && alive(p.pid)) (p.restarts > 3 ? warn : pass)(`${name}: rodando desde ${p.startedAt} (pid ${p.pid}, ${p.restarts} reinício(s))`)
  else if (name === 'caddy' && st.upnp?.enabled && !['80/TCP', '443/TCP'].every((x) => st.upnp.mapped?.includes(x))) fail('caddy: esperando as portas 80 e 443 chegarem a este PC (veja "Roteador" abaixo)')
  else fail(`${name}: parado (veja logs\\${name}.log)`)
}
const adv = st.livekit?.nodeIP
if (adv && adv === pub) pass(`LiveKit anuncia o IP público (${adv})`)
else fail(`LiveKit anuncia '${adv ?? '?'}', o IP público é ${pub ?? '?'} (o supervisor corrige em até 5 min; se persistir, o STUN está falhando)`)

console.log('== Portas neste PC')
const get = (host, servername, timeout = 6000) => new Promise((resolve) => {
  const req = https.request({ host, port: 443, servername, path: '/', headers: { Host: servername }, rejectUnauthorized: !dryRun, timeout, agent: false }, (res) => {
    let body = ''
    res.setEncoding('utf8').on('data', (d) => (body += d)).on('end', () => resolve({ body: body.trim(), cert: res.socket.getPeerCertificate() }))
  })
  req.on('timeout', () => req.destroy(new Error('tempo esgotado'))).on('error', (e) => resolve({ error: e.code ?? e.message })).end()
})
const tcp = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 3000 }, () => { s.destroy(); resolve(true) })
  s.on('timeout', () => { s.destroy(); resolve(false) }).on('error', () => resolve(false))
})
const sig = await fetch(`http://127.0.0.1:${SIGNAL_PORT}/`, { signal: AbortSignal.timeout(4000) }).then((r) => r.text(), () => '')
if (sig.trim() === 'OK') pass(`LiveKit responde em 127.0.0.1:${SIGNAL_PORT} (só local)`); else fail(`LiveKit não responde em 127.0.0.1:${SIGNAL_PORT}`)
if (await tcp(lan ?? '127.0.0.1', 7881)) pass('7881/tcp (mídia por TCP) escutando'); else fail('7881/tcp não escuta')
if (await stunProbe(lan ?? '127.0.0.1', 3478)) pass('TURN/UDP 3478 responde (local)'); else fail('TURN/UDP 3478 não responde localmente')

console.log('== Firewall do Windows')
try {
  const n = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-NetFirewallRule -Group 'Alga Meet SFU' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }).Count"], { encoding: 'utf8', windowsHide: true }).trim())
  if (n >= 3) pass(`${n} regras de entrada "Alga Meet SFU" ativas`)
  else (dryRun ? warn : fail)(`${n} regra(s) de entrada "Alga Meet SFU" (esperado: 3). Sem elas ninguém de fora entra: rode install.ps1`)
} catch { warn('não consegui ler as regras do firewall') }

console.log('== Roteador (UPnP)')
if (st.upnp?.enabled === false) info(dryRun ? 'desligado em DRY_RUN' : 'UPNP=0: portas encaminhadas à mão no roteador')
else if (!igd) fail('o roteador não respondeu por UPnP')
else {
  let ok = 0
  const table = await listMappings(igd)
  for (const [port, proto] of PUBLIC_PORTS) {
    const m = findMapping(table, port, proto)
    if (m?.client === lan) ok++
    else if (m) fail(`${port}/${proto} está encaminhada para OUTRA máquina (${m.client}, "${m.name}"): o servidor antigo ainda segura a porta`)
    else fail(`${port}/${proto} sem encaminhamento`)
  }
  if (ok === PUBLIC_PORTS.length) pass(`${ok} encaminhamentos para este PC (${lan})`)
}

console.log(`== TLS (${dryRun ? 'certificado de teste' : "certificados Let's Encrypt"})`)
for (const host of [domain, `turn.${domain}`]) {
  const cert = await new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: 443, servername: host, rejectUnauthorized: !dryRun, timeout: 6000 }, () => { const c = s.getPeerCertificate(); s.destroy(); resolve(c) })
    s.on('timeout', () => { s.destroy(); resolve(null) }).on('error', () => resolve(null))
  })
  const issuer = cert?.issuer?.O ?? cert?.issuer?.CN
  if (cert?.valid_to && (dryRun || /let's encrypt/i.test(issuer ?? ''))) pass(`${host}: emitido por ${issuer}, válido até ${cert.valid_to}`)
  else fail(`${host}: sem certificado válido ainda (as portas 80 e 443 chegam de fora? veja logs\\caddy.log, linhas com "acme")`)
}

console.log('== LiveKit pelo Caddy, e de fora para dentro')
const local = await get('127.0.0.1', domain)
if (local.body === 'OK') pass(`https://${domain}/ -> OK (local, via Caddy)`); else fail(`https://${domain}/ local: ${local.error ?? local.body}`)
// Hairpin = the router sends traffic for its own public IP back inside. It is how THIS PC's own Alga Meet app reaches
// the SFU (same name, same public IP), and how LiveKit's TURN relays to <public IP>:7882.
if (pub && !dryRun) {
  const h1 = await get(pub, domain)
  const h2 = await stunProbe(pub, 3478)
  if (h1.body === 'OK' && h2) pass('NAT loopback (hairpin) funciona: portas abertas no IP público, e o app deste próprio PC alcança o SFU')
  else warn(`sem NAT loopback (443: ${h1.body ?? h1.error}, 3478/udp: ${h2 ? 'ok' : 'falhou'}): daqui de dentro não dá para saber se as portas abriram. Teste de fora (README §6)`)
  const ready = await fetch(`${st.api}/api/v1/ready`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json(), () => null)
  if (ready?.checks?.livekit === 'ok') pass(`${st.api}/api/v1/ready -> livekit: ok (a API, de fora, alcança o SFU)`)
  else fail(`${st.api}/api/v1/ready -> livekit: ${ready?.checks?.livekit ?? 'sem resposta'}`)
}

console.log('== Sistema')
try {
  const q = execFileSync('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'], { encoding: 'latin1', windowsHide: true })
  const ac = [...q.matchAll(/:\s*0x([0-9a-f]{8})\s*$/gim)].at(-2)?.[1]   // last two lines: AC index, then DC index
  if (ac === undefined) warn('não consegui ler a suspensão do Windows')
  else if (parseInt(ac, 16) === 0) pass('o PC nunca suspende na tomada')
  else fail(`o PC suspende depois de ${Math.round(parseInt(ac, 16) / 60)} min parado: suspenso, ninguém entra em chamada (Configurações > Sistema > Energia > Suspender: Nunca)`)
} catch { warn('não consegui ler a suspensão do Windows') }
try { const s = fs.statfsSync(DIR); info(`disco livre: ${Math.floor((s.bavail * s.bsize) / 2 ** 30)} GB`) } catch {}
for (const name of ['livekit', 'caddy']) {
  try {
    const text = fs.readFileSync(path.join(DIR, 'logs', `${name}.log`), 'utf8')
    // Not problems: LiveKit has no CPU monitor on Windows (it only feeds multi-node capacity limits), and a probe
    // that connects to 443 and hangs up (this script, port scanners) is logged by Caddy as "EOF".
    const errs = text.split('\n').filter((l) => /"level":\s*"error"|\bERROR\b/.test(l) && !/CPU monitoring unsupported|"error":"EOF"/.test(l)).slice(-3)
    if (errs.length) { info(`últimos erros em logs\\${name}.log:`); for (const e of errs) info(`   ${e.slice(0, 200)}`) }
  } catch {}
}
console.log(fails ? `\n${fails} falha(s).` : '\nTudo certo.')
process.exit(fails ? 1 : 0)
