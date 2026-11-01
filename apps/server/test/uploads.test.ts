/** Attachments, signed downloads, avatars/icons, storage cleanup and the S3 driver. */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { MAX_ATTACHMENTS, type Invite, type Me, type Message, type Space, type SpaceSnapshot } from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { attachments, storageDeletions } from '../src/db/schema.js'
import { safeUrl } from '../src/errors.js'
import { contentDisposition, isInlineType, safeFilename } from '../src/files.js'
import { parseRange } from '../src/routes/files.js'
import { S3Storage } from '../src/storage.js'
import { api, connect, register, startServer, type TestServer } from './helpers.js'

const PUBLIC = 'https://api.alga.test'
const MAX = 64 * 1024
const dirs: string[] = []
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'alga-uploads-test-')); dirs.push(d); return d }

let s: TestServer
beforeAll(async () => {
  s = await startServer({ PUBLIC_URL: PUBLIC, UPLOADS_DIR: tempDir(), MAX_ATTACHMENT_BYTES: String(MAX) })
})
afterAll(async () => {
  await s.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** A real w×h RGB PNG; `headerOnly` keeps a tiny IDAT (the header alone decides the decoded size). */
function png(w: number, h: number, headerOnly = false): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(headerOnly ? 64 : (w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0)),
  ])
}
const HTML = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

interface Part { name: string; data: Buffer; type?: string; field?: string }

async function multipart(app: FastifyInstance, method: 'POST' | 'PUT', url: string, token: string, files: Part[], payload?: unknown) {
  const fd = new FormData()
  if (payload !== undefined) fd.append('payload_json', JSON.stringify(payload))
  for (const f of files) fd.append(f.field ?? 'files', new Blob([new Uint8Array(f.data)], { type: f.type ?? 'application/octet-stream' }), f.name)
  const req = new Request('http://x', { method: 'POST', body: fd })
  const res = await app.inject({
    method, url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': req.headers.get('content-type')! },
    payload: Buffer.from(await req.arrayBuffer()),
  })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined }
}

async function download(app: FastifyInstance, url: string, headers: Record<string, string> = {}) {
  const u = new URL(url)
  expect(u.origin).toBe(PUBLIC)
  return app.inject({ method: 'GET', url: u.pathname + u.search, headers })
}

const leftoverSpools = () => readdirSync(tmpdir()).filter((f) => f.startsWith('alga-upload-'))

async function spaceWithMember(app = s.app) {
  const [owner, member, outsider] = [await register(app), await register(app), await register(app)]
  const space = (await api<SpaceSnapshot>(app, 'POST', '/spaces', { token: owner.token, body: { name: 'files' } })).body
  const invite = (await api<Invite>(app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  expect((await api(app, 'POST', `/invites/${invite.code}`, { token: member.token })).status).toBe(200)
  return { owner, member, outsider, space, text: space.channels.find((c) => c.type === 'text')! }
}

describe('message attachments', () => {
  it('stores files with sniffed types, sanitized names and image sizes; every viewer gets their own signed URL', async () => {
    const { owner, member, text } = await spaceWithMember()
    const gw = await connect(s.port, member.token)
    const res = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [
      { name: 'foto.png', data: png(3, 2), type: 'image/png' },
      { name: '..\\..\\C:\\notas\u202Etxt.exe', data: Buffer.from('só texto\n'), type: 'text/plain' },
    ], { content: '', nonce: 'n1' })
    expect(res.status).toBe(200)
    const msg = res.body as Message
    expect(msg.content).toBe('')
    expect(msg.nonce).toBe('n1')
    expect(msg.attachments).toHaveLength(2)
    const [img, txt] = msg.attachments
    expect(img).toMatchObject({ filename: 'foto.png', contentType: 'image/png', width: 3, height: 2 })
    expect(txt).toMatchObject({ filename: 'notastxt.exe', contentType: 'application/octet-stream', size: Buffer.byteLength('só texto\n') })
    expect(txt).not.toHaveProperty('width')
    expect(new URL(img!.url).searchParams.get('uid')).toBe(owner.user.id)

    const live = await gw.waitFor('MESSAGE_CREATE', (m) => m.id === msg.id)
    expect(new URL(live.attachments[0]!.url).searchParams.get('uid')).toBe(member.user.id)
    gw.close()
    const history = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: member.token })).body
    expect(history[0]!.attachments.map((a) => a.id)).toEqual([img!.id, txt!.id])

    const got = await download(s.app, live.attachments[0]!.url)
    expect(got.statusCode).toBe(200)
    // Re-encoded (no metadata), same pixels.
    expect(got.rawPayload.length).toBe(img!.size)
    expect(await sharp(got.rawPayload).metadata()).toMatchObject({ format: 'png', width: 3, height: 2 })
    expect(got.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'cross-origin',
    })
    expect(got.headers['content-disposition']).toMatch(/^inline; filename="foto.png"/)
    expect(got.headers['cache-control']).toMatch(/^private, max-age=\d+$/)
    const doc = await download(s.app, txt!.url)
    expect(doc.headers['content-type']).toBe('application/octet-stream')
    expect(doc.headers['content-disposition']).toMatch(/^attachment; /)
  })

  it('needs ATTACH_FILES and channel access before reading any byte', async () => {
    const { owner, member, outsider, space, text } = await spaceWithMember()
    const files = [{ name: 'a.png', data: png(1, 1) }]
    expect((await multipart(s.app, 'POST', `/channels/${text.id}/messages`, outsider.token, files, { content: 'x' })).status).toBe(403)
    // Drop ATTACH_FILES from @everyone (role id == space id).
    const everyone = space.roles.find((r) => r.id === space.id)!
    const { Permission } = await import('@alga/shared')
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${everyone.id}`, {
      token: owner.token, body: { permissions: everyone.permissions & ~Permission.ATTACH_FILES },
    })).status).toBe(200)
    expect((await multipart(s.app, 'POST', `/channels/${text.id}/messages`, member.token, files, { content: 'x' })).status).toBe(403)
    // Plain JSON messages still work without it.
    expect((await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: member.token, body: { content: 'ok' } })).status).toBe(200)
    expect(leftoverSpools()).toEqual([])
  })

  it('content-type spoofing: HTML/SVG named .png is a download, an image named .html gets its real extension', async () => {
    const { owner, text } = await spaceWithMember()
    const res = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [
      { name: 'gato.png', data: HTML, type: 'image/png' },
      { name: 'logo.svg', data: SVG, type: 'image/svg+xml' },
      { name: 'evil.html', data: png(2, 2), type: 'text/html' },
      { name: 'doc.png', data: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), type: 'image/png' },
    ], { content: 'olha' })
    expect(res.status).toBe(200)
    const [html, svg, img, pdf] = (res.body as Message).attachments
    expect(html!.contentType).toBe('application/octet-stream')
    expect(svg!.contentType).toBe('application/octet-stream')
    expect(img).toMatchObject({ contentType: 'image/png', filename: 'evil.png' })
    expect(pdf).toMatchObject({ contentType: 'application/octet-stream', filename: 'doc.png' })
    for (const a of [html!, svg!, pdf!]) {
      const r = await download(s.app, a.url)
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toBe('application/octet-stream')
      expect(r.headers['content-disposition']).toMatch(/^attachment; /)
      expect(r.headers['x-content-type-options']).toBe('nosniff')
    }
  })

  it('enforces the per-file cap and MAX_ATTACHMENTS with 413, leaving nothing behind', async () => {
    const { owner, text } = await spaceWithMember()
    const big = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [
      { name: 'ok.png', data: png(1, 1) }, { name: 'big.bin', data: Buffer.alloc(MAX + 1) },
    ], { content: 'x' })
    expect(big.status).toBe(413)
    const many = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token,
      Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from(String(i)) })), { content: 'x' })
    expect(many.status).toBe(413)
    expect((await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [], { content: '' })).status).toBe(400)
    expect(leftoverSpools()).toEqual([])
    const history = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: owner.token })).body
    expect(history).toEqual([])
  })

  it('signed URLs: tampering, another viewer, expiry and lost access are refused', async () => {
    const { owner, member, outsider, space, text } = await spaceWithMember()
    const msg = (await multipart(s.app, 'POST', `/channels/${text.id}/messages`, member.token, [{ name: 'a.png', data: png(1, 1) }], { content: 'x' })).body as Message
    const url = new URL(msg.attachments[0]!.url)
    const variant = (k: string, v: string) => { const u = new URL(url); u.searchParams.set(k, v); return u.toString() }
    expect((await download(s.app, url.toString())).statusCode).toBe(200)
    expect((await download(s.app, variant('sig', url.searchParams.get('sig')!.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))))).statusCode).toBe(403)
    expect((await download(s.app, variant('exp', String(Number(url.searchParams.get('exp')) + 3600)))).statusCode).toBe(403)
    expect((await download(s.app, variant('uid', outsider.user.id))).statusCode).toBe(403)
    const expired = s.app.ctx.files.url(msg.attachments[0]!.id, member.user.id, Date.now() - 3 * 3600_000)
    expect((await download(s.app, expired)).statusCode).toBe(403)
    // A correctly signed URL for someone who cannot see the channel.
    expect((await download(s.app, s.app.ctx.files.url(msg.attachments[0]!.id, outsider.user.id))).statusCode).toBe(404)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${member.user.id}`, { token: owner.token })).status).toBe(204)
    expect((await download(s.app, url.toString())).statusCode).toBe(404)
  })

  it('serves single byte ranges (video seeking)', async () => {
    const { owner, text } = await spaceWithMember()
    const data = Buffer.from('0123456789abcdef')
    const msg = (await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [{ name: 'd.bin', data }], {})).body as Message
    const part = await download(s.app, msg.attachments[0]!.url, { range: 'bytes=2-5' })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 2-5/${data.length}`)
    expect(part.body).toBe('2345')
    expect((await download(s.app, msg.attachments[0]!.url, { range: 'bytes=-3' })).body).toBe('def')
    expect((await download(s.app, msg.attachments[0]!.url, { range: 'bytes=99-' })).statusCode).toBe(416)
    expect(parseRange('bytes=0-1,4-5', 10)).toBeUndefined()
  })

  it('deleting the message (or its channel) deletes the stored objects; failures are retried, not dropped', async () => {
    const { owner, text, space } = await spaceWithMember()
    const files = s.app.ctx.files
    const send = async () => {
      const m = (await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [{ name: 'a.png', data: png(1, 1) }], {})).body as Message
      const key = `attachments/${text.id}/${m.attachments[0]!.id}`
      expect(await files.storage.get(key)).not.toBeNull()
      return { m, key }
    }
    const one = await send()
    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${one.m.id}`, { token: owner.token })).status).toBe(204)
    await files.sweep()
    expect(await files.storage.get(one.key)).toBeNull()

    const two = await send()
    const del = vi.spyOn(files.storage, 'delete').mockRejectedValueOnce(new Error('bucket down'))
    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${two.m.id}`, { token: owner.token })).status).toBe(204)
    await files.sweep()
    const [queued] = await s.app.ctx.db.select().from(storageDeletions).where(eq(storageDeletions.key, two.key))
    expect(queued).toMatchObject({ attempts: 1, lastError: 'bucket down' })
    expect(queued!.notBefore.getTime()).toBeGreaterThan(Date.now())
    await s.app.ctx.db.update(storageDeletions).set({ notBefore: new Date(0) }).where(eq(storageDeletions.key, two.key))
    await files.sweep()
    expect(await files.storage.get(two.key)).toBeNull()
    del.mockRestore()

    const three = await send()
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}`, { token: owner.token })).status).toBe(204)
    await files.sweep()
    expect(await files.storage.get(three.key)).toBeNull()
    expect(await s.app.ctx.db.select().from(storageDeletions)).toEqual([])
  })
})

describe('avatars and space icons', () => {
  it('upload sets an own URL served publicly; replacing or clearing deletes the old object', async () => {
    const a = await register(s.app)
    const up = await multipart(s.app, 'PUT', '/users/@me/avatar', a.token, [{ field: 'file', name: 'eu.png', data: png(64, 64), type: 'image/jpeg' }])
    expect(up.status).toBe(200)
    const first = (up.body as Me).avatarUrl!
    expect(first).toMatch(new RegExp(`^${PUBLIC}/api/v1/avatars/${a.user.id}/[0-9a-f]{32}\\.webp$`))
    const img = await download(s.app, first)
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/webp')
    expect(img.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(img.headers['x-content-type-options']).toBe('nosniff')

    const second = ((await multipart(s.app, 'PUT', '/users/@me/avatar', a.token, [{ field: 'file', name: 'x.gif', data: png(8, 8) }])).body as Me).avatarUrl!
    expect(second).not.toBe(first)
    await s.app.ctx.files.sweep()
    expect((await download(s.app, first)).statusCode).toBe(404)
    expect((await download(s.app, second)).statusCode).toBe(200)
    // Our own current URL is accepted by PATCH; clearing deletes the object.
    expect((await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { avatarUrl: second } })).status).toBe(200)
    expect((await api<Me>(s.app, 'PATCH', '/users/@me', { token: a.token, body: { avatarUrl: null } })).body.avatarUrl).toBeNull()
    await s.app.ctx.files.sweep()
    expect((await download(s.app, second)).statusCode).toBe(404)
  })

  it('rejects SVG, HTML disguised as PNG, oversized images and non-multipart bodies', async () => {
    const a = await register(s.app)
    const put = (data: Buffer, name = 'a.png') => multipart(s.app, 'PUT', '/users/@me/avatar', a.token, [{ field: 'file', name, data, type: 'image/png' }])
    expect((await put(SVG, 'a.svg')).status).toBe(400)
    expect((await put(HTML)).status).toBe(400)
    expect((await put(png(4097, 1))).status).toBe(400)
    expect((await api(s.app, 'PUT', '/users/@me/avatar', { token: a.token, body: { url: 'https://x/a.png' } })).status).toBe(400)
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: a.token })).body.avatarUrl).toBeNull()
    expect(leftoverSpools()).toEqual([])
  })

  it('space icon: MANAGE_SPACE only, SPACE_UPDATE to members, shown in the public invite preview', async () => {
    const { owner, member, space } = await spaceWithMember()
    const icon = [{ field: 'file', name: 'i.png', data: png(16, 16) }]
    expect((await multipart(s.app, 'PUT', `/spaces/${space.id}/icon`, member.token, icon)).status).toBe(403)
    const gw = await connect(s.port, member.token)
    const res = await multipart(s.app, 'PUT', `/spaces/${space.id}/icon`, owner.token, icon)
    expect(res.status).toBe(200)
    const iconUrl = (res.body as Space).iconUrl!
    expect(iconUrl).toMatch(new RegExp(`^${PUBLIC}/api/v1/icons/${space.id}/[0-9a-f]{32}\\.webp$`))
    await gw.waitFor('SPACE_UPDATE', (d) => d.iconUrl === iconUrl)
    gw.close()
    const invite = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
    expect((await api<Invite>(s.app, 'GET', `/invites/${invite.code}`)).body.space.iconUrl).toBe(iconUrl)
    expect((await download(s.app, iconUrl)).statusCode).toBe(200)
  })
})

describe('image privacy (re-encoded with sharp)', () => {
  const MARKER = 'MARKER-Rua-Exemplo-123'
  /** 40×20 JPEG shot "rotated" (EXIF orientation 6 = displayed 20×40) with GPS, a camera field and a Display P3 profile. */
  const phoneJpeg = () => sharp({ create: { width: 40, height: 20, channels: 3, background: '#d03030' } })
    .withExifMerge({
      IFD0: { Make: 'Phone', ImageDescription: MARKER },
      IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '46/1 38/1 0/1' },
    })
    .withMetadata({ orientation: 6 }).withIccProfile('p3').jpeg().toBuffer()
  // GPSInfo IFD pointer tag (0x8825), either byte order.
  const hasGps = (exif: Buffer | undefined) => !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])))
  const animatedGif = async (frames: number, w = 8, h = 8) => sharp(
    await Promise.all(Array.from({ length: frames }, (_, i) => sharp({ create: { width: w, height: h, channels: 3, background: i % 2 ? '#0f0' : '#00f' } }).png().toBuffer())),
    { join: { animated: true } },
  ).gif({ delay: 50 }).toBuffer()

  it('a phone JPEG loses EXIF/GPS/ICC, gets its orientation applied and reports the displayed size', async () => {
    const { owner, text } = await spaceWithMember()
    const input = await phoneJpeg()
    const before = await sharp(input).metadata()
    expect(before).toMatchObject({ width: 40, height: 20, orientation: 6 })
    expect(hasGps(before.exif)).toBe(true)
    expect(before.icc).toBeDefined()
    expect(input.includes(Buffer.from(MARKER))).toBe(true)

    const msg = (await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [{ name: 'IMG_0001.JPG', data: input }], {})).body as Message
    expect(msg.attachments[0]).toMatchObject({ filename: 'IMG_0001.JPG', contentType: 'image/jpeg', width: 20, height: 40 })
    const out = (await download(s.app, msg.attachments[0]!.url)).rawPayload
    expect(out.length).toBe(msg.attachments[0]!.size)
    const after = await sharp(out).metadata()
    expect(after).toMatchObject({ format: 'jpeg', width: 20, height: 40, space: 'srgb' })
    expect(after.orientation).toBeUndefined()
    expect(after.exif).toBeUndefined()
    expect(after.icc).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(out.includes(Buffer.from(MARKER))).toBe(false)
    // The stored row matches what is served.
    const [row] = await s.app.ctx.db.select().from(attachments).where(eq(attachments.id, msg.attachments[0]!.id))
    expect(row).toMatchObject({ width: 20, height: 40, size: out.length })
  })

  it('keeps GIF animation and size, scales anything past 8192 px down, avatars become ≤ 1024 px WebP', async () => {
    const { owner, text } = await spaceWithMember()
    const msg = (await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [
      { name: 'dance.gif', data: await animatedGif(6, 12, 10) },
      { name: 'wide.png', data: png(9000, 2) },
    ], {})).body as Message
    const [gif, wide] = msg.attachments
    expect(gif).toMatchObject({ contentType: 'image/gif', width: 12, height: 10 })
    expect(await sharp((await download(s.app, gif!.url)).rawPayload, { animated: true }).metadata()).toMatchObject({ format: 'gif', pages: 6, pageHeight: 10 })
    expect(wide).toMatchObject({ contentType: 'image/png', width: 8192, height: 2 })

    const a = await register(s.app)
    const put = async (data: Buffer, name: string) => {
      const me = (await multipart(s.app, 'PUT', '/users/@me/avatar', a.token, [{ field: 'file', name, data }])).body as Me
      return sharp((await download(s.app, me.avatarUrl!)).rawPayload, { animated: true }).metadata()
    }
    const still = await put(await phoneJpeg(), 'eu.jpg')
    expect(still).toMatchObject({ format: 'webp', width: 20, height: 40 })
    expect(still.exif).toBeUndefined()
    expect(await put(png(2048, 1024), 'big.png')).toMatchObject({ format: 'webp', width: 1024, height: 512 })
    expect(await put(await animatedGif(4, 1200, 1200), 'anim.gif')).toMatchObject({ format: 'webp', width: 1024, pages: 4, pageHeight: 1024 })
  })

  it('refuses decompression bombs and endless animations, storing nothing', async () => {
    const { owner, text } = await spaceWithMember()
    const put = vi.spyOn(s.app.ctx.files.storage, 'put')
    try {
      // 20000×20000 = 400 MP declared by a ~100-byte file.
      const bomb = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [
        { name: 'ok.txt', data: Buffer.from('ok') }, { name: 'bomb.png', data: png(20_000, 20_000, true) },
      ], { content: 'x' })
      expect(bomb.status).toBe(400)
      expect(bomb.body.error.fields.files).toMatch(/megapixels/)
      const frames = await multipart(s.app, 'POST', `/channels/${text.id}/messages`, owner.token, [{ name: 'long.gif', data: await animatedGif(501, 2, 2) }], {})
      expect(frames.status).toBe(400)
      expect(frames.body.error.fields.files).toMatch(/quadros/)
      const avatar = await multipart(s.app, 'PUT', '/users/@me/avatar', owner.token, [{ field: 'file', name: 'a.gif', data: await animatedGif(501, 2, 2) }])
      expect(avatar.status).toBe(400)
      expect(put).not.toHaveBeenCalled()
    } finally {
      put.mockRestore()
    }
    expect((await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: owner.token })).body).toEqual([])
    expect(leftoverSpools()).toEqual([])
  })
})

describe('helpers and config', () => {
  it('file URL signatures stay out of request logs', () => {
    expect(safeUrl('/api/v1/files/x?uid=u&exp=1&sig=SECRET')).toBe('/api/v1/files/x?uid=u&exp=1&sig=<redacted>')
  })

  it('filenames and Content-Disposition stay safe', () => {
    const octet = { contentType: 'application/octet-stream' }
    expect(safeFilename('../../etc/passwd', octet)).toBe('passwd')
    expect(safeFilename('  .hidden. ', octet)).toBe('hidden')
    expect(safeFilename('a<b>:c|d?.txt', octet)).toBe('a_b__c_d_.txt')
    expect(safeFilename('', octet)).toBe('arquivo')
    expect(safeFilename(`${'é'.repeat(300)}.pdf`, octet)).toBe(`${'é'.repeat(124)}.pdf`)
    expect(safeFilename('photo.JPEG', { contentType: 'image/jpeg', ext: 'jpg' })).toBe('photo.JPEG')
    expect(contentDisposition('attachment', 'relatório "final".pdf'))
      .toBe(`attachment; filename="relat_rio _final_.pdf"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf`)
  })

  it('production needs PUBLIC_URL (https), FILES_SECRET and an explicit STORAGE_DRIVER; s3 needs its settings', () => {
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null',
      LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef',
      PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32), STORAGE_DRIVER: 'local',
      EMAIL_DRIVER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Alga Meet <nao-responda@example.com>', E2EE_DS_KEY: 'A'.repeat(43) + '=',
    }
    expect(loadConfig(PROD).storage.driver).toBe('local')
    expect(() => loadConfig({ ...PROD, PUBLIC_URL: 'http://api.example.com' })).toThrow(/PUBLIC_URL/)
    expect(() => loadConfig({ ...PROD, FILES_SECRET: undefined })).toThrow(/FILES_SECRET/)
    expect(() => loadConfig({ ...PROD, STORAGE_DRIVER: undefined })).toThrow(/STORAGE_DRIVER/)
    expect(() => loadConfig({ ...PROD, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/)
    expect(loadConfig({ NODE_ENV: 'test', PORT: '4100' }).publicUrl).toBe('http://127.0.0.1:4100')
  })
})

describe('S3 driver', () => {
  let fake: Server
  let endpoint: string
  const objects = new Map<string, { body: Buffer; type: string }>()
  const seen: { method: string; url: string; auth: string; sha: string }[] = []

  beforeAll(async () => {
    // Minimal S3: checks SigV4 presence and the payload hash, honours Range.
    fake = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const auth = String(req.headers.authorization ?? '')
        const sha = String(req.headers['x-amz-content-sha256'] ?? '')
        seen.push({ method: req.method!, url: req.url!, auth, sha })
        if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=AK/')) return res.writeHead(403).end()
        const key = req.url!
        if (req.method === 'PUT') {
          if (sha !== createHash('sha256').update(body).digest('hex') || Number(req.headers['content-length']) !== body.length) return res.writeHead(400).end('BadDigest')
          objects.set(key, { body, type: String(req.headers['content-type']) })
          return res.writeHead(200).end()
        }
        const obj = objects.get(key)
        if (req.method === 'DELETE') { objects.delete(key); return res.writeHead(204).end() }
        if (!obj) return res.writeHead(404).end('NoSuchKey')
        const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''))
        if (m) return res.writeHead(206, { 'content-type': obj.type }).end(obj.body.subarray(Number(m[1]), Number(m[2]) + 1))
        res.writeHead(200, { 'content-type': obj.type }).end(obj.body)
      })
    })
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
    endpoint = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => fake.close(() => r())))

  it('uploads, downloads (with Range) and deletes through a signed S3 API', async () => {
    const srv = await startServer({
      PUBLIC_URL: PUBLIC, STORAGE_DRIVER: 's3', S3_ENDPOINT: endpoint, S3_BUCKET: 'alga', S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK', S3_URL_STYLE: 'path',
    })
    try {
      const { owner, text } = await spaceWithMember(srv.app)
      const data = png(5, 4)
      // 3 MiB: well past the 256 KiB JSON body limit, under the default 25 MiB file cap.
      const blob = randomBytes(3 * 1024 * 1024)
      const msg = (await multipart(srv.app, 'POST', `/channels/${text.id}/messages`, owner.token, [{ name: 'p.png', data }, { name: 'b.bin', data: blob }], {})).body as Message
      const key = `/alga/attachments/${text.id}/${msg.attachments[0]!.id}`
      expect(objects.get(key)).toMatchObject({ type: 'image/png' })
      expect(objects.get(`/alga/attachments/${text.id}/${msg.attachments[1]!.id}`)!.body.equals(blob)).toBe(true)
      const got = await download(srv.app, msg.attachments[0]!.url)
      const stored = objects.get(key)!.body
      expect(got.rawPayload.equals(stored)).toBe(true)
      expect((await download(srv.app, msg.attachments[0]!.url, { range: 'bytes=0-7' })).rawPayload.equals(stored.subarray(0, 8))).toBe(true)
      expect((await api(srv.app, 'DELETE', `/channels/${text.id}/messages/${msg.id}`, { token: owner.token })).status).toBe(204)
      await srv.app.ctx.files.sweep()
      expect(objects.has(key)).toBe(false)
      expect(seen.map((r) => r.method)).toEqual(expect.arrayContaining(['PUT', 'GET', 'DELETE']))
    } finally {
      await srv.close()
    }
  })

  it('builds virtual-hosted URLs by default (Railway Buckets, R2, AWS)', async () => {
    const urls: string[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(input instanceof Request ? input.url : String(input))
      return new Response(null, { status: 204 })
    })
    try {
      await new S3Storage({ driver: 's3', endpoint: 'https://t3.storageapi.dev', bucket: 'b-123', region: 'auto', accessKeyId: 'a', secretAccessKey: 'b', pathStyle: false })
        .delete('avatars/u/x.png')
    } finally {
      spy.mockRestore()
    }
    expect(urls).toEqual(['https://b-123.t3.storageapi.dev/avatars/u/x.png'])
  })
})

describe('inline types', () => {
  it('plays Opus voice notes inline (file-type reports "audio/ogg; codecs=opus")', () => {
    expect(isInlineType('audio/ogg; codecs=opus')).toBe(true)
  })
})
