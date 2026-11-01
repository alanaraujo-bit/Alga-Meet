/** E-mail verification, password reset, B5 (registration enumeration), B10 (password policy) and the e-mail drivers. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GatewayClose, type AuthResponse, type Invite, type Me, type SpaceSnapshot } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import { sha256Hex } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { emailTokens } from '../src/db/schema.js'
import { OutboxSender, ResendSender, type EmailMessage } from '../src/email.js'
import { weakPassword } from '../src/passwords.js'
import { api, befriend, connect, freshIp, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
let sent: MockInstance<(msg: EmailMessage) => Promise<void>>
beforeAll(async () => {
  s = await startServer({ EMAIL_LINK_URL: 'https://app.alga.test/auth/' })
  sent = vi.spyOn(s.app.ctx.mail.sender, 'send')
})
afterAll(async () => { await s.close() })

const mailsTo = (to: string, kind?: EmailMessage['kind']) => sent.mock.calls.map(([m]) => m).filter((m) => m.to === to && (!kind || m.kind === kind))
/** Waits for the n-th mail of `kind` to `to` (mail goes out after the response). */
async function mailTo(to: string, kind: EmailMessage['kind'], n = 1): Promise<EmailMessage> {
  await vi.waitFor(() => expect(mailsTo(to, kind).length).toBeGreaterThanOrEqual(n), { timeout: 3000 })
  return mailsTo(to, kind)[n - 1]!
}
const settle = () => new Promise((r) => setTimeout(r, 250))
const tokenIn = (m: EmailMessage) => /token=([A-Za-z0-9_-]{43})\b/.exec(m.text)![1]!

let n = 0
const fresh = () => `mail${++n}_${Math.random().toString(36).slice(2, 6)}`
const STRONG = 'uma frase longa e boa'

async function registerRaw(email: string, username: string, password = STRONG) {
  return api<AuthResponse>(s.app, 'POST', '/auth/register', { ip: freshIp(), body: { email, username, password } })
}

describe('e-mail verification', () => {
  it('register sends a 24 h link (hashed at rest); verifying is single use, live (ME_UPDATE) and lifts the limits', async () => {
    const a = await register(s.app, fresh(), { verified: false })
    const b = await register(s.app, fresh())
    expect(a.user.emailVerified).toBe(false)
    const mail = await mailTo(a.user.email, 'verify_email')
    expect(mail).toMatchObject({ subject: 'Confirme seu e-mail no Alga Meet' })
    const token = tokenIn(mail)
    expect(mail.text).toContain(`https://app.alga.test/auth/verify-email?token=${token}`)
    expect(mail.html).toContain(`https://app.alga.test/auth/verify-email?token=${token}`)
    // No user-chosen text in a mail that can reach a stranger's inbox.
    expect(mail.text).not.toContain(a.user.username)
    const [row] = await s.app.ctx.db.select().from(emailTokens).where(eq(emailTokens.userId, a.user.id))
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row!.tokenHash).not.toBe(token)
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000)

    // Unverified: one space, no invites, no DM with a non-friend; e-mail login not yet.
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'um' } }))
    expect(space.status).toBe(201)
    expect((await api(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'dois' } })).status).toBe(403)
    const inv = await api(s.app, 'POST', `/spaces/${space.body.id}/invites`, { token: a.token, body: {} })
    expect(inv.status).toBe(403)
    expect(inv.body.error.message).toMatch(/Confirme seu e-mail/)
    const bSpace = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: b.token, body: { name: 'b' } })).body
    const code = (await api<Invite>(s.app, 'POST', `/spaces/${bSpace.id}/invites`, { token: b.token, body: {} })).body.code
    expect((await api(s.app, 'POST', `/invites/${code}`, { token: a.token })).status).toBe(200)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).status).toBe(403)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.email, password: a.password } })).status).toBe(401)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: a.password } })).status).toBe(200)

    const gw = await connect(s.port, a.token)
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token } })).status).toBe(204)
    expect((await gw.waitFor('ME_UPDATE', (d) => d.emailVerified === true)).id).toBe(a.user.id)
    gw.close()
    const again = await api(s.app, 'POST', '/auth/verify-email', { body: { token } })
    expect(again.status).toBe(400)
    expect(again.body.error.fields.token).toBeDefined()

    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: a.token })).body.emailVerified).toBe(true)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.email, password: a.password } })).status).toBe(200)
    expect((await api(s.app, 'POST', `/spaces/${space.body.id}/invites`, { token: a.token, body: {} })).status).toBe(201)
    expect((await api(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'dois' } })).status).toBe(201)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).status).toBe(201)
  })

  it('unverified users still DM friends; expired, unknown and newer-replaced tokens are refused', async () => {
    const a = await register(s.app, fresh(), { verified: false })
    const b = await register(s.app, fresh())
    await befriend(s.app, a, b)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).status).toBe(201)

    const first = tokenIn(await mailTo(a.user.email, 'verify_email'))
    expect((await api(s.app, 'POST', '/auth/verify-email/resend', { token: a.token })).status).toBe(204)
    const second = tokenIn(await mailTo(a.user.email, 'verify_email', 2))
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token: first } })).status).toBe(400) // replaced
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token: 'x'.repeat(43) } })).status).toBe(400)
    await s.app.ctx.db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailTokens.userId, a.user.id))
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token: second } })).status).toBe(400) // expired
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: a.token })).body.emailVerified).toBe(false)
  })

  it('resend: 3 per 15 min per user, nothing for a verified account, at most 3 mails per address per hour', async () => {
    const a = await register(s.app, fresh(), { verified: false })
    await mailTo(a.user.email, 'verify_email')
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await api(s.app, 'POST', '/auth/verify-email/resend', { token: a.token })).status)
    expect(codes).toEqual([204, 204, 204, 429])
    await settle()
    expect(mailsTo(a.user.email)).toHaveLength(3) // register + 2 resends; the third resend hit the address quota

    const v = await register(s.app, fresh())
    await settle()
    const before = mailsTo(v.user.email).length
    expect((await api(s.app, 'POST', '/auth/verify-email/resend', { token: v.token })).status).toBe(204)
    await settle()
    expect(mailsTo(v.user.email)).toHaveLength(before)
  })

  it('two accounts claiming one address: the first to confirm owns it, the other gets 409', async () => {
    const email = `${fresh()}@example.com`
    const [x, y] = [await registerRaw(email, fresh()), await registerRaw(email, fresh())]
    expect([x.status, y.status]).toEqual([201, 201])
    await mailTo(email, 'verify_email', 2)
    const [tx, ty] = mailsTo(email).map(tokenIn)
    expect(tx).not.toBe(ty)
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token: tx! } })).status).toBe(204)
    expect((await api(s.app, 'POST', '/auth/verify-email', { body: { token: ty! } })).status).toBe(409)
  })
})

describe('B5 registration does not reveal a taken e-mail', () => {
  it('same response for a fresh and a taken address; the owner is told by mail, the newcomer gets no link', async () => {
    const owner = await register(s.app, fresh())
    const freshReg = await registerRaw(`${fresh()}@example.com`, fresh())
    const takenReg = await registerRaw(owner.user.email.toUpperCase(), fresh())
    expect(takenReg.status).toBe(201)
    expect(freshReg.status).toBe(201)
    expect(Object.keys(takenReg.body).sort()).toEqual(Object.keys(freshReg.body).sort())
    expect(Object.keys(takenReg.body.user).sort()).toEqual(Object.keys(freshReg.body.user).sort())
    expect(takenReg.body.user).toMatchObject({ email: owner.user.email, emailVerified: false })

    const notice = await mailTo(owner.user.email, 'account_exists')
    expect(notice).toMatchObject({ subject: 'Você já tem uma conta no Alga Meet' })
    expect(notice.text).toContain(`@${owner.user.username}`)
    expect(notice.text).not.toMatch(/token=/)
    expect(await s.app.ctx.db.select().from(emailTokens).where(eq(emailTokens.userId, takenReg.body.user.id))).toEqual([])

    // The owner keeps logging in by e-mail; the newcomer only by username, and resending tells the owner again.
    expect((await api<AuthResponse>(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: owner.user.email, password: owner.password } })).body.user.id).toBe(owner.user.id)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: owner.user.email, password: STRONG } })).status).toBe(401)
    expect((await api(s.app, 'POST', '/auth/verify-email/resend', { token: takenReg.body.token })).status).toBe(204)
    await mailTo(owner.user.email, 'account_exists', 2)

    // Usernames are public: a taken one is still reported.
    const dupName = await registerRaw(`${fresh()}@example.com`, owner.user.username)
    expect(dupName.status).toBe(409)
    expect(dupName.body.error.fields).toEqual({ username: expect.any(String) })
  })
})

describe('password reset', () => {
  it('always 204; mails only existing addresses; confirm is single use, revokes every session (4004) and verifies the e-mail', async () => {
    const a = await register(s.app, fresh(), { verified: false })
    const ghost = `${fresh()}@example.com`
    expect((await api(s.app, 'POST', '/auth/password-reset/request', { ip: freshIp(), body: { email: ghost } })).status).toBe(204)
    expect((await api(s.app, 'POST', '/auth/password-reset/request', { ip: freshIp(), body: { email: a.user.email.toUpperCase() } })).status).toBe(204)
    const mail = await mailTo(a.user.email, 'password_reset')
    expect(mail).toMatchObject({ subject: 'Redefinir sua senha do Alga Meet' })
    const token = tokenIn(mail)
    expect(mail.text).toContain(`https://app.alga.test/auth/reset-password?token=${token}`)
    await settle()
    expect(mailsTo(ghost)).toEqual([])
    const [row] = await s.app.ctx.db.select().from(emailTokens).where(eq(emailTokens.tokenHash, sha256Hex(token)))
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000)
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(3500_000)

    const gw = await connect(s.port, a.token)
    // A refused password does not burn the link.
    const weak = await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token, password: 'password123' } })
    expect(weak.status).toBe(400)
    expect(weak.body.error.fields.password).toBeDefined()
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token, password: 'outra frase bem longa' } })).status).toBe(204)
    expect((await gw.closed).code).toBe(GatewayClose.SESSION_REVOKED)
    expect((await api(s.app, 'GET', '/users/@me', { token: a.token })).status).toBe(401)
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token, password: 'mais uma frase longa' } })).status).toBe(400)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: a.password } })).status).toBe(401)
    const login = await api<AuthResponse>(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.email, password: 'outra frase bem longa' } })
    expect(login.status).toBe(200) // by e-mail: the reset proved the inbox
    expect(login.body.user.emailVerified).toBe(true)
  })

  it('expired tokens are refused; changing the password kills pending reset links', async () => {
    const a = await register(s.app, fresh())
    await api(s.app, 'POST', '/auth/password-reset/request', { ip: freshIp(), body: { email: a.user.email } })
    const t1 = tokenIn(await mailTo(a.user.email, 'password_reset'))
    await s.app.ctx.db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(emailTokens.userId, a.user.id))
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token: t1, password: 'outra frase bem longa' } })).status).toBe(400)

    await api(s.app, 'POST', '/auth/password-reset/request', { ip: freshIp(), body: { email: a.user.email } })
    const t2 = tokenIn(await mailTo(a.user.email, 'password_reset', 2))
    expect((await api(s.app, 'POST', '/auth/password', { token: a.token, body: { currentPassword: a.password, newPassword: 'trocada por dentro do app' } })).status).toBe(204)
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token: t2, password: 'outra frase bem longa' } })).status).toBe(400)
  })

  it('rate limits: 5 requests per 15 min per IP (429), at most 3 mails per address per hour (silent)', async () => {
    const ip = freshIp()
    const codes = []
    for (let i = 0; i < 6; i++) codes.push((await api(s.app, 'POST', '/auth/password-reset/request', { ip, body: { email: `${fresh()}@example.com` } })).status)
    expect(codes).toEqual([204, 204, 204, 204, 204, 429])

    const a = await register(s.app, fresh())
    for (let i = 0; i < 5; i++) {
      expect((await api(s.app, 'POST', '/auth/password-reset/request', { ip: freshIp(), body: { email: a.user.email } })).status).toBe(204)
    }
    await settle()
    const resets = mailsTo(a.user.email, 'password_reset')
    expect(resets).toHaveLength(3)
    // The dropped requests did not replace the last link the owner received.
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { ip: freshIp(), body: { token: tokenIn(resets[2]!), password: 'outra frase bem longa' } })).status).toBe(204)
  })
})

describe('B10 password policy', () => {
  it('refuses short, common, trivial and personal passwords on register, change and reset', async () => {
    const reg = async (password: string) => (await registerRaw(`${fresh()}@example.com`, 'maria_silva', password)).body.error?.fields?.password
    expect(await reg('nove12345')).toBeDefined() // 9 characters
    expect(await reg('Password123')).toMatch(/comum/)
    expect(await reg('senha123456')).toMatch(/comum/)
    expect(await reg('QWERTYUIOP')).toMatch(/comum/)
    expect(await reg('maria_silva2024')).toMatch(/nome de usuário/)

    const a = await register(s.app, fresh())
    const change = await api(s.app, 'POST', '/auth/password', { token: a.token, body: { currentPassword: a.password, newPassword: '1q2w3e4r5t' } })
    expect(change.status).toBe(400)
    expect(change.body.error.fields.newPassword).toMatch(/comum/)
  })

  it('weakPassword rules', () => {
    const who = { username: 'joao', email: 'joao.p@example.com' }
    expect(weakPassword('aaaaaaaaaaaa', who)).toMatch(/repetições/)
    expect(weakPassword('abcabcabcab', who)).toMatch(/repetições/)
    expect(weakPassword('abcdefghijk', who)).toMatch(/sequências/)
    expect(weakPassword('9876543210', who)).toMatch(/comum|sequências/)
    expect(weakPassword('meu-joao-forte', who)).toMatch(/nome de usuário/)
    expect(weakPassword('xx-joao.p-xx', who)).toMatch(/nome de usuário/)
    expect(weakPassword('correct horse battery', who)).toBeNull()
    expect(weakPassword('Tr0ub4dor&3xyz', who)).toBeNull()
  })
})

describe('e-mail drivers and config', () => {
  const msg: EmailMessage = { to: 'ana@example.com', kind: 'verify_email', subject: 'Confirme seu e-mail', text: 'Olá\ntoken=SEGREDO', html: '<p>Olá</p>' }
  it('console driver: one .eml per message; the body (token) is logged only outside production', async () => {
    const dir = join(s.config.email.driver === 'console' ? s.config.email.outboxDir : '', 'driver-test')
    const [devLog, prodLog] = [{ info: vi.fn() }, { info: vi.fn() }]
    await new OutboxSender(dir, 'Alga Meet <nao-responda@alga.test>', devLog as never, true).send(msg)
    await new OutboxSender(dir, 'Alga Meet <nao-responda@alga.test>', prodLog as never, false).send(msg)
    const files = readdirSync(dir)
    expect(files).toHaveLength(2)
    expect(files.every((f) => f.endsWith('.eml') && f.includes('-verify_email-') && !f.includes('ana'))).toBe(true)
    const eml = readFileSync(join(dir, files[0]!), 'utf8')
    expect(eml).toMatch(/^From: Alga Meet <nao-responda@alga.test>\r\nTo: ana@example.com\r\nSubject: =\?UTF-8\?B\?/)
    expect(eml).toContain('Content-Type: multipart/alternative')
    expect(eml).toContain('token=SEGREDO')
    expect(JSON.stringify(devLog.info.mock.calls)).toContain('SEGREDO')
    expect(JSON.stringify(prodLog.info.mock.calls)).not.toMatch(/SEGREDO|ana@example/)
  })

  it('resend driver: POST https://api.resend.com/emails with the API key; non-2xx throws', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init! })
      return calls.length === 1 ? Response.json({ id: 'em_1' }) : Response.json({ statusCode: 403, name: 'validation_error', message: 'domain not verified' }, { status: 403 })
    })
    try {
      const resend = new ResendSender('re_123', 'Alga Meet <nao-responda@algameet.com.br>')
      await resend.send(msg)
      expect(calls[0]!.url).toBe('https://api.resend.com/emails')
      expect(calls[0]!.init.method).toBe('POST')
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_123')
      expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
        from: 'Alga Meet <nao-responda@algameet.com.br>', to: ['ana@example.com'], subject: msg.subject, text: msg.text, html: msg.html,
      })
      await expect(resend.send(msg)).rejects.toThrow(/HTTP 403 .*domain not verified/)
    } finally {
      spy.mockRestore()
    }
  })

  it('production fails closed: EMAIL_DRIVER required, console only when allowed, resend needs its key and sender', () => {
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null',
      LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef',
      PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32), STORAGE_DRIVER: 'local',
    }
    const RESEND = { EMAIL_DRIVER: 'resend', RESEND_API_KEY: 're_x', EMAIL_FROM: 'Alga Meet <nao-responda@example.com>' }
    expect(() => loadConfig(PROD)).toThrow(/EMAIL_DRIVER/)
    expect(() => loadConfig({ ...PROD, EMAIL_DRIVER: 'console' })).toThrow(/ALGA_ALLOW_CONSOLE_EMAIL/)
    expect(loadConfig({ ...PROD, EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1' }).email.driver).toBe('console')
    expect(() => loadConfig({ ...PROD, ...RESEND, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/)
    expect(() => loadConfig({ ...PROD, ...RESEND, EMAIL_FROM: undefined })).toThrow(/EMAIL_FROM/)
    expect(loadConfig({ ...PROD, ...RESEND }).email).toMatchObject({ driver: 'resend', apiKey: 're_x', linkUrl: 'algameet://auth' })
    expect(loadConfig({ NODE_ENV: 'test' }).email.driver).toBe('console')
  })
})
