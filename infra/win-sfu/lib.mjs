// Shared helpers of the Windows SFU kit (README.md). Node only, no dependencies.
import { execFileSync } from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns'
import { readFileSync } from 'node:fs'

// The machine has IPv6; everything here (DuckDNS A record, media, router mappings) is IPv4.
dns.setDefaultResultOrder('ipv4first')

// Ports the internet must reach on this PC (router mapping + Windows Firewall rule). Same set as infra/home-sfu.
export const PUBLIC_PORTS = [[80, 'TCP'], [443, 'TCP'], [7881, 'TCP'], [7882, 'UDP'], [3478, 'UDP']]
// Internal only (Caddy -> LiveKit on loopback). NOT 7880: that is the dev SFU's port on this same PC (npm run dev).
export const SIGNAL_PORT = 7870
export const TURN_TLS_PORT = 5349
export const UPNP_NAME = 'alga-sfu'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s ?? '')
export const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|127\.)/.test(ip ?? '')

export function readEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

// Validates .env without ever echoing a secret. Returns only what is safe to print/store.
export function checkEnv(env) {
  // DUCKDNS_TOKEN is optional: without it nobody updates the DNS record, which is fine only while the home's public
  // IP stays the one the record already has (sfu.mjs and doctor.mjs say so).
  for (const k of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'ALGA_API_URL', 'DUCKDNS_SUBDOMAIN']) if (!env[k]) throw new Error(`${k} vazio ou ausente no .env`)
  if (env.LIVEKIT_API_KEY === 'devkey') throw new Error('LIVEKIT_API_KEY=devkey é o par público de dev; use o par da API (Railway)')
  if (!/^[A-Za-z0-9_-]+$/.test(env.LIVEKIT_API_KEY)) throw new Error('LIVEKIT_API_KEY com caracteres inesperados')
  if (env.LIVEKIT_API_SECRET.length < 32) throw new Error('LIVEKIT_API_SECRET com menos de 32 caracteres')
  const api = env.ALGA_API_URL.replace(/\/+$/, '')
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(api)) throw new Error('ALGA_API_URL deve ser https://host, sem caminho')
  const sub = env.DUCKDNS_SUBDOMAIN.replace(/\.duckdns\.org$/, '')
  if (!/^[a-z0-9-]+$/.test(sub)) throw new Error('DUCKDNS_SUBDOMAIN deve ser só o nome (ex.: alga, para alga.duckdns.org)')
  return { sub, domain: `${sub}.duckdns.org`, key: env.LIVEKIT_API_KEY, api, dry: env.DRY_RUN === '1', upnp: env.UPNP !== '0' && env.DRY_RUN !== '1' }
}

export async function publicIPv4() {
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip']) {
    try {
      const ip = (await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).text()).trim()
      if (isIPv4(ip)) return ip
    } catch {}
  }
  return null
}

// Local IPv4 of the interface that routes to the internet. connect() on UDP sends nothing: it only picks the route.
export function lanIPv4() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    s.once('error', () => { try { s.close() } catch {} resolve(null) })
    s.connect(53, '1.1.1.1', () => { const a = s.address().address; s.close(); resolve(isIPv4(a) ? a : null) })
  })
}

// Default gateway of that interface, from the routing table ("0.0.0.0  0.0.0.0  <gateway>  <interface>  <metric>").
export function gatewayIPv4(lan) {
  try {
    const out = execFileSync('route.exe', ['print', '-4', '0.0.0.0'], { encoding: 'latin1', windowsHide: true })
    const rows = [...out.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+\d+/gm)]
    return (rows.find((r) => r[2] === lan) ?? rows[0])?.[1] ?? null
  } catch { return null }
}

// --- UPnP IGD (the router). Discovery is unicast to the gateway first: the reply to a unicast request passes the
// Windows Firewall on a "Public" network, where multicast SSDP replies are dropped. -------------------------------
export async function findIgd(lan, gateway) {
  const locations = await new Promise((resolve) => {
    const found = new Set()
    const s = dgram.createSocket('udp4')
    s.on('error', () => {})
    s.on('message', (msg) => { const l = /^location:\s*(\S+)/im.exec(msg.toString())?.[1]; if (l) found.add(l) })
    s.bind(0, lan ?? undefined, () => {
      for (const v of [1, 2]) {
        const m = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:${v}\r\n\r\n`
        if (gateway) s.send(m, 1900, gateway)
        s.send(m, 1900, '239.255.255.250')
      }
    })
    setTimeout(() => { try { s.close() } catch {} resolve([...found]) }, 3000)
  })
  for (const loc of locations) {
    try {
      const xml = await (await fetch(loc, { signal: AbortSignal.timeout(4000) })).text()
      for (const svc of xml.split('<service>').slice(1)) {
        const type = /<serviceType>([^<]*)/.exec(svc)?.[1] ?? ''
        const ctl = /<controlURL>([^<]*)/.exec(svc)?.[1]
        if (/:WAN(IP|PPP)Connection:\d$/.test(type) && ctl) return { type, ctl: new URL(ctl, loc).href, loc }
      }
    } catch {}
  }
  return null
}

const esc = (v) => String(v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
async function soap(igd, action, args) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${igd.type}">${Object.entries(args).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`
  try {
    const res = await fetch(igd.ctl, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${igd.type}#${action}"` }, body, signal: AbortSignal.timeout(5000) })
    const text = await res.text()
    return { ok: res.ok, text, code: Number(/<errorCode>(\d+)/.exec(text)?.[1] ?? 0) }
  } catch (e) { return { ok: false, text: String(e.message), code: -1 } }
}
const tag = (text, name) => new RegExp(`<${name}>([^<]*)`).exec(text)?.[1] ?? ''

export async function routerWanIp(igd) {
  const r = await soap(igd, 'GetExternalIPAddress', {})
  return r.ok ? tag(r.text, 'NewExternalIPAddress') || null : null
}
// Every forwarding the router has, by walking its table. NOT GetSpecificPortMappingEntry: the owner's Huawei EchoLife
// answers 714 "NoSuchEntryInArray" to it for forwardings that do exist (measured 2026-11-16), and believing that
// answer would make this kit overwrite another machine's ports.
export async function listMappings(igd) {
  const list = []
  for (let i = 0; i < 400; i++) {
    const r = await soap(igd, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i })
    if (!r.ok) break
    list.push({ port: Number(tag(r.text, 'NewExternalPort')), proto: tag(r.text, 'NewProtocol').toUpperCase(), client: tag(r.text, 'NewInternalClient'), name: tag(r.text, 'NewPortMappingDescription'), lease: Number(tag(r.text, 'NewLeaseDuration')) })
  }
  return list
}
// null = no forwarding for that external port
export const findMapping = (list, port, proto) => list.find((m) => m.port === port && m.proto === proto) ?? null
// 1 h lease, renewed by the supervisor; some routers only accept permanent leases (error 725): retry with 0.
export async function addMapping(igd, port, proto, lan) {
  const args = (lease) => ({ NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto, NewInternalPort: port, NewInternalClient: lan, NewEnabled: 1, NewPortMappingDescription: UPNP_NAME, NewLeaseDuration: lease })
  let r = await soap(igd, 'AddPortMapping', args(3600))
  if (!r.ok) r = await soap(igd, 'AddPortMapping', args(0))
  return r.ok ? { ok: true } : { ok: false, code: r.code }
}
export async function deleteMapping(igd, port, proto) {
  return (await soap(igd, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto })).ok
}

// STUN binding request: true when something STUN/TURN-speaking answers on host:port (no credentials needed).
export function stunProbe(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    const tid = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)))
    const done = (v) => { clearTimeout(t); try { s.close() } catch {} resolve(v) }
    const t = setTimeout(() => done(false), ms)
    s.on('error', () => done(false))
    s.on('message', (d) => done(d.readUInt16BE(0) === 0x0101 && d.subarray(8, 20).equals(tid)))
    const req = Buffer.alloc(20)
    req.writeUInt16BE(0x0001, 0); req.writeUInt16BE(0, 2); req.writeUInt32BE(0x2112a442, 4); tid.copy(req, 8)
    s.send(req, port, host)
  })
}
