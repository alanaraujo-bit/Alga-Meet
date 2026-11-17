/**
 * Fills an EMPTY QA database with plausible test data for the admin app (apps/admin-android): ~4 months of signups,
 * daily activity, voice sessions, messages, Plus subscriptions (renewing, yearly, Pix, passes), cosmetic orders,
 * refunds, reports, feedback and call-quality reports. Everything is fake (e-mails @exemplo.test, sandbox provider).
 * Never point it at a real database: it refuses NODE_ENV=production and DATABASE_URL.
 *
 *   PGLITE_DIR=<dir> npx tsx scripts/seed-admin-demo.ts <credentials-file>
 *
 * Creates the staff account "dono" (admin) with a random password written to <credentials-file>.
 */
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { PLUS_PASS_PRODUCT_ID, REMOVED_USER_ID, uuidv7, zonedDay } from '@alga/shared'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { ACTIVITY_FLAGS } from '../src/activity/activity.js'
import { addDays, dayStart, mondayOf } from '../src/activity/spans.js'
import { buildApp } from '../src/app.js'
import { hashPassword } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import {
  activityDays, adminEvents, callQualityReports, channels, feedback, gifts, messages, metricDaily, orders, products, reports,
  sessions, spaceMembers, spaces, subscriptions, uninstallFeedback, users, voiceSessions, voiceWeekly,
} from '../src/db/schema.js'

const out = process.argv[2]
if (!out) throw new Error('usage: tsx scripts/seed-admin-demo.ts <credentials-file>')
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('QA only: refusing a production or external database')

const config = loadConfig({ ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', LOG_LEVEL: 'warn', BILLING_PROVIDER: 'sandbox' })
const app = await buildApp(config)
const db = app.ctx.db

const [existing] = await db.select({ id: users.id }).from(users).where(ne(users.id, REMOVED_USER_ID)).limit(1)
if (existing) { await app.close(); throw new Error('database is not empty: seed only a fresh QA directory') }

// Deterministic randomness: the same seed gives the same demo.
let state = 20261116
const rnd = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
const DAY = 86_400_000
const MIN = 60_000
const now = Date.now()
const today = zonedDay(now)

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Lucas', 'Mariana', 'Mateus', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Valentina', 'Vinícius', 'Yasmin', 'Caio', 'Beatriz', 'Gustavo', 'Letícia', 'Pedro', 'Júlia', 'André']
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Rocha', 'Carvalho', 'Gomes', 'Ribeiro', 'Martins', 'Barbosa', 'Araújo', 'Teixeira', 'Moreira']
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ---- people -----------------------------------------------------------------------------------------------------------
const hash = await hashPassword(randomBytes(24).toString('base64url'))
type Person = { id: string; createdAt: number; engagement: number }
const people: Person[] = []
const userRows: (typeof users.$inferInsert)[] = []
const N = 260
for (let i = 0; i < N; i++) {
  // Signups accelerate: more of them in recent weeks.
  const ageDays = Math.floor(Math.pow(rnd(), 1.6) * 125)
  const createdAt = now - ageDays * DAY - Math.floor(rnd() * DAY)
  const first = pick(FIRST); const last = pick(LAST)
  const username = `${fold(first)}${fold(last).slice(0, 4)}${i}`
  const id = uuidv7()
  const verified = rnd() < 0.86
  userRows.push({
    id, email: `${username}@exemplo.test`, username, displayName: `${first} ${last}`, passwordHash: hash, createdAt: new Date(createdAt),
    emailVerifiedAt: verified ? new Date(createdAt + 20 * MIN) : null, birthDate: rnd() < 0.9 ? `${1980 + Math.floor(rnd() * 26)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}` : null,
  })
  people.push({ id, createdAt, engagement: rnd() })
}
const ownerPassword = randomBytes(12).toString('base64url')
const ownerId = uuidv7()
userRows.push({
  id: ownerId, email: 'dono@exemplo.test', username: 'dono', displayName: 'Dono do Alga', passwordHash: await hashPassword(ownerPassword),
  createdAt: new Date(now - 140 * DAY), emailVerifiedAt: new Date(now - 140 * DAY), staffRole: 'admin', birthDate: '1995-03-10',
})
for (let i = 0; i < userRows.length; i += 200) await db.insert(users).values(userRows.slice(i, i + 200))

// ---- activity: opened / messaged / voice, by day (90 days kept) -----------------------------------------------------
const act: (typeof activityDays.$inferInsert)[] = []
const voiceDays: { userId: string; day: string; withOther: boolean }[] = []
for (const p of people) {
  const signupDay = zonedDay(p.createdAt)
  for (let d = 0; d < 90; d++) {
    const day = addDays(today, -d)
    if (day < signupDay) break
    const since = Math.round((dayStart(day) - dayStart(signupDay)) / DAY)
    // Retention curve: strong on the first days, settling around each person's engagement.
    const pActive = since === 0 ? 0.97 : Math.min(0.92, 0.12 + 0.75 * p.engagement * (0.35 + 0.65 * Math.exp(-since / 9)))
    if (rnd() > pActive) continue
    let flags = ACTIVITY_FLAGS.OPENED
    if (rnd() < 0.62) flags |= ACTIVITY_FLAGS.MESSAGED
    if (rnd() < 0.38 + 0.3 * p.engagement) {
      flags |= ACTIVITY_FLAGS.VOICE_3MIN
      const withOther = rnd() < 0.82
      if (withOther) flags |= ACTIVITY_FLAGS.VOICE_WITH_OTHER
      voiceDays.push({ userId: p.id, day, withOther })
    }
    act.push({ userId: p.id, day, flags })
  }
}
for (let i = 0; i < act.length; i += 1000) await db.insert(activityDays).values(act.slice(i, i + 1000))

// ---- spaces, channels, messages -------------------------------------------------------------------------------------
const SPACE_NAMES = ['Taverna do Dragão', 'Estúdio 22', 'Clube do Livro', 'Os Desenrolados', 'Turma do Lab', 'Guilda Noturna', 'Sala de Estudos', 'Cinéfilos', 'Futebol de Quinta', 'Programadores BR', 'Família Rocha', 'Valorant Squad', 'Coral da Vila', 'Feira de Ideias']
const spaceIds: { id: string; text: string; voice: string; members: string[] }[] = []
for (const name of SPACE_NAMES) {
  const owner = pick(people)
  const id = uuidv7(); const text = uuidv7(); const voice = uuidv7()
  const created = Math.max(owner.createdAt + DAY, now - 110 * DAY + rnd() * 100 * DAY)
  await db.insert(spaces).values({ id, name, ownerId: owner.id, createdAt: new Date(Math.min(created, now - DAY)) })
  await db.insert(channels).values([{ id: text, type: 'text', spaceId: id, name: 'geral' }, { id: voice, type: 'voice', spaceId: id, name: 'Voz', position: 1 }])
  const members = [owner.id, ...Array.from({ length: 4 + Math.floor(rnd() * 14) }, () => pick(people).id)]
  const uniq = [...new Set(members)]
  await db.insert(spaceMembers).values(uniq.map((userId) => ({ spaceId: id, userId })))
  spaceIds.push({ id, text, voice, members: uniq })
}
const LINES = ['bora jogar hoje?', 'alguém viu o episódio novo?', 'tô entrando na call', 'kkkkk', 'boa noite, pessoal', 'quem topa às 21h?', 'mandei o link ali', 'valeu demais', 'chego em 10 min', 'que partida!']
const msgRows: (typeof messages.$inferInsert)[] = []
for (const a of act) {
  if (!(a.flags! & ACTIVITY_FLAGS.MESSAGED)) continue
  const mine = spaceIds.filter((s) => s.members.includes(a.userId!))
  if (!mine.length) continue
  const n = 1 + Math.floor(rnd() * 6)
  for (let k = 0; k < n; k++) {
    const at = dayStart(a.day!) + (10 + rnd() * 13.9) * 60 * MIN
    if (at > now) continue
    msgRows.push({ id: uuidv7(), channelId: pick(mine).text, authorId: a.userId!, content: pick(LINES), createdAt: new Date(at) })
  }
}
for (let i = 0; i < msgRows.length; i += 1000) await db.insert(messages).values(msgRows.slice(i, i + 1000))

// ---- voice: raw sessions for 35 days, weekly totals for 12 weeks ----------------------------------------------------
const vs: (typeof voiceSessions.$inferInsert)[] = []
const weekly = new Map<string, { userId: string; week: string; channelId: string; spaceId: string; minutes: number; nights: number }>()
for (const v of voiceDays) {
  const mine = spaceIds.filter((s) => s.members.includes(v.userId))
  const s = mine.length ? pick(mine) : pick(spaceIds)
  const sessionsToday = 1 + Math.floor(rnd() * 2)
  let total = 0
  for (let k = 0; k < sessionsToday; k++) {
    const len = Math.round(Math.exp(Math.log(8) + rnd() * Math.log(18))) // ~8 to ~140 min
    const start = dayStart(v.day) + (19 + rnd() * 4) * 60 * MIN
    const end = Math.min(start + len * MIN, now)
    if (end <= start) continue
    total += (end - start) / MIN
    if (start >= now - 35 * DAY) vs.push({ id: uuidv7(), userId: v.userId, channelId: s.voice, spaceId: s.id, joinedAt: new Date(start), leftAt: new Date(end) })
  }
  const week = mondayOf(v.day)
  if (week < addDays(mondayOf(today), -7 * 11)) continue
  const key = `${v.userId}:${week}:${s.voice}`
  const w = weekly.get(key) ?? { userId: v.userId, week, channelId: s.voice, spaceId: s.id, minutes: 0, nights: 0 }
  w.minutes += Math.round(total)
  if (total >= 30) w.nights++
  weekly.set(key, w)
}
for (let i = 0; i < vs.length; i += 1000) await db.insert(voiceSessions).values(vs.slice(i, i + 1000))
const wk = [...weekly.values()]
for (let i = 0; i < wk.length; i += 1000) await db.insert(voiceWeekly).values(wk.slice(i, i + 1000))

// ---- sessions (app versions in use) ---------------------------------------------------------------------------------
const VERSIONS = ['0.1.18; Windows 11', '0.1.18; Windows 11', '0.1.18; Windows 10', '0.1.17; Windows 11', '0.1.16; Windows 10']
const sess = people.filter((p) => p.engagement > 0.25).map((p) => ({
  id: uuidv7(), userId: p.id, tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'), userAgent: 'AlgaMeet/0.1.18',
  clientInfo: pick(VERSIONS), createdAt: new Date(Math.max(p.createdAt, now - 60 * DAY)), lastUsedAt: new Date(now - rnd() * 6 * DAY),
}))
await db.insert(sessions).values(sess)

// ---- money -----------------------------------------------------------------------------------------------------------
const catalog = await db.select().from(products).where(eq(products.active, true))
const cosmetics = catalog.filter((p) => (p.kind === 'cosmetic' || p.kind === 'bundle') && p.priceBrlCents > 0)
const addMonths = (t: number, m: number) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime() }
const subRows: (typeof subscriptions.$inferInsert)[] = []
const plusUsers = new Map<string, number>()
const buyers = [...people].sort((a, b) => b.engagement - a.engagement)
const payers = buyers.slice(0, 46)
payers.forEach((p, i) => {
  const yearly = i % 9 === 4
  const start = Math.max(p.createdAt + 2 * DAY, now - (5 + rnd() * 115) * DAY)
  if (start > now - DAY) return
  const months = yearly ? 12 : 1
  // Renewed every cycle up to now; then the period runs ahead.
  let end = addMonths(start, months)
  while (end < now) end = addMonths(end, months)
  let status: 'active' | 'past_due' | 'expired' | 'canceled' = 'active'
  let cancelAtPeriodEnd = false
  let updatedAt = now - rnd() * 3 * DAY
  if (i % 11 === 3) { status = 'expired'; end = addMonths(start, months * (1 + Math.floor(rnd() * 2))); updatedAt = Math.min(end + DAY, now); if (end > now) { end = now - 4 * DAY; updatedAt = end } }
  else if (i % 13 === 5) { status = 'canceled'; end = addMonths(start, months); updatedAt = start + 4 * DAY }
  else if (i % 17 === 7) status = 'past_due'
  else if (i % 7 === 2) cancelAtPeriodEnd = true
  const amount = yearly ? 14900 : 1490
  subRows.push({
    id: uuidv7(), userId: p.id, productId: yearly ? 'plus_yearly' : 'plus_monthly', planId: 'plus', status, kind: 'renewing',
    currentPeriodEnd: new Date(end), cancelAtPeriodEnd, amountCents: amount, currency: 'BRL', provider: 'sandbox',
    providerSubscriptionId: `sbx_sub_${i}`, startedAt: new Date(start), createdAt: new Date(start), updatedAt: new Date(updatedAt),
    refundRequestedAt: status === 'canceled' ? new Date(start + 3 * DAY) : null,
  })
  if (status === 'active' || status === 'past_due') plusUsers.set(p.id, start)
})
// Passes: free 7-day Plus from a friend.
for (const p of buyers.slice(60, 66)) {
  const start = now - rnd() * 5 * DAY
  subRows.push({ id: uuidv7(), userId: p.id, productId: PLUS_PASS_PRODUCT_ID, planId: 'plus', status: 'active', kind: 'pass', currentPeriodEnd: new Date(start + 7 * DAY), amountCents: 0, currency: 'BRL', provider: 'sandbox', startedAt: new Date(start), createdAt: new Date(start), grantedBy: pick(payers).id })
  plusUsers.set(p.id, start)
}
const orderRows: (typeof orders.$inferInsert)[] = []
const giftRows: (typeof gifts.$inferInsert)[] = []
// Plus paid once with Pix: an order plus its period.
for (const p of buyers.slice(70, 75)) {
  const paid = now - rnd() * 25 * DAY
  const oid = uuidv7()
  orderRows.push({ id: oid, userId: p.id, productId: 'plus_monthly', status: 'paid', amountCents: 1490, currency: 'BRL', provider: 'sandbox', providerPaymentId: `sbx_pix_${oid}`, createdAt: new Date(paid - 5 * MIN), updatedAt: new Date(paid), paidAt: new Date(paid) })
  subRows.push({ id: uuidv7(), userId: p.id, productId: 'plus_monthly', planId: 'plus', status: 'active', kind: 'period', orderId: oid, currentPeriodEnd: new Date(addMonths(paid, 1)), amountCents: 1490, currency: 'BRL', provider: 'sandbox', startedAt: new Date(paid), createdAt: new Date(paid), updatedAt: new Date(paid) })
  plusUsers.set(p.id, paid)
}
for (let i = 0; i < 95; i++) {
  const p = buyers[Math.floor(Math.pow(rnd(), 1.4) * buyers.length * 0.6)]!
  const product = pick(cosmetics)
  const paid = Math.max(p.createdAt + DAY, now - Math.pow(rnd(), 1.3) * 100 * DAY)
  if (paid > now) continue
  const oid = uuidv7()
  const refunded = i % 31 === 7
  orderRows.push({
    id: oid, userId: p.id, productId: product.id, status: refunded ? 'refunded' : 'paid', amountCents: product.priceBrlCents, currency: 'BRL',
    provider: 'sandbox', providerPaymentId: `sbx_pay_${oid}`, items: [product.id], createdAt: new Date(paid - 3 * MIN),
    updatedAt: new Date(refunded ? paid + 2 * DAY : paid), paidAt: new Date(paid), refundRequestedAt: refunded ? new Date(paid + 2 * DAY) : null,
  })
  if (i % 6 === 1) giftRows.push({ id: uuidv7(), orderId: oid, productId: product.id, senderId: p.id, recipientId: pick(people).id, status: 'accepted', deliveredAt: new Date(paid), createdAt: new Date(paid), updatedAt: new Date(paid) })
}
await db.insert(orders).values(orderRows)
await db.insert(subscriptions).values(subRows)
if (giftRows.length) await db.insert(gifts).values(giftRows)
for (const [id, since] of plusUsers) await db.update(users).set({ plan: 'plus', plusSince: new Date(since) }).where(eq(users.id, id))

// ---- trust & safety, feedback, quality, north star, uninstall --------------------------------------------------------
const REASONS = ['spam', 'harassment', 'spam', 'scam', 'other', 'hate', 'violence'] as const
for (let i = 0; i < 16; i++) {
  const reporter = pick(people); const target = pick(people)
  if (reporter.id === target.id) continue
  const open = i < 5
  const reason = pick(REASONS)
  await db.insert(reports).values({
    id: uuidv7(), reporterId: reporter.id, targetType: 'user', targetId: target.id, targetUserId: target.id, reason, details: '',
    snapshot: { user: { username: 'teste' } }, priority: reason === 'violence' ? 50 : 10, status: open ? 'open' : i % 3 ? 'resolved' : 'dismissed',
    action: open ? null : 'none', createdAt: new Date(now - rnd() * 20 * DAY), resolvedAt: open ? null : new Date(now - rnd() * 5 * DAY),
  }).onConflictDoNothing()
}
const FEEDBACK = [
  ['bug', 'O áudio cortou duas vezes quando meu amigo compartilhou a tela.'],
  ['idea', 'Seria ótimo poder agendar a sala de cinema para sexta à noite.'],
  ['praise', 'A qualidade da voz está muito melhor que no app que a gente usava.'],
  ['bug', 'Às vezes o app abre com a lista de canais vazia e preciso reiniciar.'],
  ['idea', 'Queria um modo compacto para a lista de membros.'],
  ['crash', 'Fechou sozinho ao arrastar um arquivo grande para a conversa.'],
  ['praise', 'O Alga Worlds ficou lindo, a galera passou a noite decorando a sala.'],
] as const
for (const [kind, text] of FEEDBACK) {
  await db.insert(feedback).values({ id: uuidv7(), userId: pick(people).id, kind, text, client: pick(VERSIONS), context: { route: 'qa' } as never, createdAt: new Date(now - rnd() * 9 * DAY) })
}
const OS = ['windows', 'windows', 'windows']
const q: (typeof callQualityReports.$inferInsert)[] = []
for (let i = 0; i < 340; i++) {
  const day = new Date(now - rnd() * 7 * DAY).toISOString().slice(0, 10)
  q.push({
    id: crypto.randomUUID(), day, userHash: randomBytes(8).toString('hex'), sessionDurationS: Math.round(300 + rnd() * 7000),
    joinMs: Math.round(380 + Math.pow(rnd(), 2.5) * 2600), reconnects: rnd() < 0.08 ? 1 : 0, reconnectFailed: rnd() < 0.012,
    rttAvgMs: 18 + rnd() * 50, rttP95Ms: 40 + rnd() * 90, jitterMs: 2 + rnd() * 9, packetLossPct: Math.pow(rnd(), 3) * 4, concealmentPct: Math.pow(rnd(), 3) * 3,
    audioCodec: 'opus', os: pick(OS), osVersion: '10.0.26100', appVersion: pick(VERSIONS).split(';')[0]!, cpuVendor: 'intel', gpuVendor: 'nvidia',
  })
}
await db.insert(callQualityReports).values(q)
for (let w = 1; w <= 10; w++) {
  const week = addDays(mondayOf(today), -7 * w)
  await db.insert(metricDaily).values({ day: week, metric: 'active_groups_week', value: Math.round(9 + (10 - w) * 1.6 + rnd() * 3) }).onConflictDoNothing()
}
const UNINSTALL = ['not_using', 'friends_elsewhere', 'friends_elsewhere', 'audio_video', 'performance', 'other']
for (let i = 0; i < 14; i++) await db.insert(uninstallFeedback).values({ id: uuidv7(), reason: pick(UNINSTALL), appVersion: '0.1.18', createdAt: new Date(now - rnd() * 28 * DAY) })

// ---- the feed: the last 3 days, as the server would have written it --------------------------------------------------
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`
const name = new Map(catalog.map((p) => [p.id, p.name]))
const feed: (typeof adminEvents.$inferInsert)[] = []
for (const o of orderRows) if (o.paidAt!.getTime() > now - 3 * DAY) feed.push({ id: uuidv7(), kind: 'purchase', title: `${o.productId === 'plus_monthly' ? 'Plus avulso' : 'Nova compra'} · ${brl(o.amountCents!)}`, body: name.get(o.productId!) ?? o.productId!, amountCents: o.amountCents, currency: 'BRL', userId: o.userId, createdAt: o.paidAt! })
for (const s of subRows) if (s.kind === 'renewing' && s.startedAt!.getTime() > now - 3 * DAY) feed.push({ id: uuidv7(), kind: 'subscription_started', title: `Nova assinatura · ${brl(s.amountCents!)}`, body: name.get(s.productId!) ?? s.productId!, amountCents: s.amountCents, currency: 'BRL', userId: s.userId, createdAt: s.startedAt! })
let count = 0
for (const u of [...userRows].sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime())) {
  count++
  if (u.createdAt!.getTime() > now - 3 * DAY && u.id !== ownerId) feed.push({ id: uuidv7(), kind: 'signup', title: 'Novo cadastro', body: `Conta nº ${count.toLocaleString('pt-BR')}.`, userId: u.id, createdAt: u.createdAt })
}
if (feed.length) await db.insert(adminEvents).values(feed)

const [plus] = await db.select({ id: users.id }).from(users).where(and(eq(users.plan, 'plus'), inArray(users.id, [...plusUsers.keys()]))).limit(1)
writeFileSync(out, `Alga Admin (QA local): login dono · senha ${ownerPassword}\n`)
console.log(JSON.stringify({ users: userRows.length, activityDays: act.length, messages: msgRows.length, voiceSessions: vs.length, subscriptions: subRows.length, orders: orderRows.length, feed: feed.length, plusExample: plus?.id }))
await app.close()
