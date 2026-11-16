// The router's port forwardings (UPnP) for the SFU's public ports. Used by install.ps1 / uninstall.ps1, run by the owner.
//   node router.mjs status     read-only: who holds each port. Exit 0 = all on this PC, 3 = another machine holds some,
//                              4 = some are not forwarded, 5 = the router did not answer
//   node router.mjs takeover   asks the router to remove "alga-sfu" forwardings that point to ANOTHER machine, so this
//                              PC can take the ports. Refuses while that machine still answers on 443 (a live SFU):
//                              stop it first. --force skips that check. The owner's Huawei EchoLife says no anyway
//                              (714, and 718 to an overwrite): it only lets the machine that created a forwarding
//                              remove it. There, a dead server's entries go away when their 1 h lease runs out, on
//                              a router reboot, or by hand on the router's page.
//   node router.mjs release    removes the forwardings that point to THIS PC (uninstall / rollback to the old server)
// The supervisor (sfu.mjs) creates and renews the forwardings by itself; it never removes another machine's.
import net from 'node:net'
import { PUBLIC_PORTS, UPNP_NAME, deleteMapping, findIgd, findMapping, gatewayIPv4, lanIPv4, listMappings } from './lib.mjs'

const cmd = process.argv[2] ?? 'status'
const force = process.argv.includes('--force')
const lan = await lanIPv4()
const igd = await findIgd(lan, gatewayIPv4(lan))
if (!igd) { console.log('O roteador não respondeu por UPnP.'); process.exit(5) }

const table = await listMappings(igd)
const rows = PUBLIC_PORTS.map(([port, proto]) => ({ port, proto, m: findMapping(table, port, proto) }))
const others = rows.filter((r) => r.m && r.m.client !== lan)
const answers = (host) => new Promise((resolve) => {
  const s = net.connect({ host, port: 443, timeout: 2500 }, () => { s.destroy(); resolve(true) })
  s.on('timeout', () => { s.destroy(); resolve(false) }).on('error', () => resolve(false))
})

if (cmd === 'status') {
  for (const { port, proto, m } of rows) console.log(`  ${String(port).padStart(5)}/${proto}  ${!m ? 'sem encaminhamento' : m.client === lan ? `este PC (${lan})` : `OUTRA máquina: ${m.client} ("${m.name}")`}`)
  process.exit(others.length ? 3 : rows.some((r) => !r.m) ? 4 : 0)
}
if (cmd === 'takeover') {
  for (const host of new Set(others.map((r) => r.m.client))) {
    if (!force && await answers(host)) { console.log(`${host} ainda responde na porta 443: o SFU antigo está ligado. Pare-o primeiro (ou use --force).`); process.exit(3) }
  }
  for (const { port, proto, m } of others) {
    if (m.name !== UPNP_NAME) { console.log(`  ${port}/${proto} -> ${m.client} ("${m.name}") não é do Alga Meet: não mexi`); continue }
    console.log(`  ${port}/${proto} -> ${m.client}: ${await deleteMapping(igd, port, proto) ? 'removido' : 'o roteador recusou'}`)
  }
  process.exit(0)
}
if (cmd === 'release') {
  for (const { port, proto, m } of rows) if (m?.client === lan && m.name === UPNP_NAME) console.log(`  ${port}/${proto}: ${await deleteMapping(igd, port, proto) ? 'removido' : 'o roteador recusou'}`)
  process.exit(0)
}
console.log('uso: node router.mjs status | takeover [--force] | release')
process.exit(2)
