import { ACTIVITY_MAX_AGE_MS, GatewayClose } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, befriend, connect, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const game = (name = 'VALORANT') => ({ kind: 'game' as const, name, startedAt: Date.now() - 60_000, icon: ICON, steamAppId: 1172470 })

describe('activity (rich presence)', () => {
  it('rides PRESENCE_UPDATE and READY, is hidden while invisible and cleared with null', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await befriend(s.app, a, b)
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)

    gwA.send({ op: 'activity', activity: game() })
    const seen = await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.activity?.name === 'VALORANT')
    expect(seen).toMatchObject({ status: 'online', activity: { kind: 'game', icon: ICON, steamAppId: 1172470 } })

    // Someone connecting later gets it in READY.
    const gwB2 = await connect(s.port, b.token)
    expect((await gwB2.waitFor('READY')).presences.find((p) => p.userId === a.user.id)?.activity?.name).toBe('VALORANT')

    // Invisible: others see offline, with no activity; back online brings it back.
    gwB.events.length = 0
    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'invisible' } })
    expect(await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'offline')).not.toHaveProperty('activity')
    const gwB3 = await connect(s.port, b.token)
    expect((await gwB3.waitFor('READY')).presences.find((p) => p.userId === a.user.id)).toBeUndefined()
    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'online' } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'online' && p.activity?.name === 'VALORANT')

    gwB.events.length = 0
    gwA.send({ op: 'activity', activity: null })
    expect(await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && !p.activity)).toMatchObject({ status: 'online' })
    for (const g of [gwA, gwB, gwB2, gwB3]) g.close()
  })

  it('is cleared when the socket that set it closes, even with another device still online', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await befriend(s.app, a, b)
    const phone = await connect(s.port, a.token)
    const pc = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)
    pc.send({ op: 'activity', activity: game('Minecraft') })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.activity?.name === 'Minecraft')
    gwB.events.length = 0
    pc.close()
    expect(await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && !p.activity)).toMatchObject({ status: 'online' })
    for (const g of [phone, gwB]) g.close()
  })

  it('clamps startedAt and rejects malformed activities', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await befriend(s.app, a, b)
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)
    gwA.send({ op: 'activity', activity: { kind: 'code', name: 'Visual Studio Code', startedAt: 1 } })
    const p = await gwB.waitFor('PRESENCE_UPDATE', (x) => x.userId === a.user.id && x.activity?.kind === 'code')
    expect(p.activity!.startedAt).toBeGreaterThanOrEqual(Date.now() - ACTIVITY_MAX_AGE_MS - 5_000)
    expect(p.activity).not.toHaveProperty('icon')

    // A non-PNG "icon" (could be anything) closes the socket like any invalid frame.
    gwA.send({ op: 'activity', activity: { ...game(), icon: 'data:text/html;base64,PHNjcmlwdD4=' } })
    expect((await gwA.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    const gwA2 = await connect(s.port, a.token)
    gwA2.send({ op: 'activity', activity: { kind: 'game', name: 'x‮evil', startedAt: Date.now() } })
    expect((await gwA2.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    gwB.close()
  })
})

describe('custom status', () => {
  it('rides presence with its expiry, is hidden while invisible, dropped when expired, and rejects junk', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await befriend(s.app, a, b)
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)
    const until = Date.now() + 3600_000
    gwA.send({ op: 'custom_status', status: { text: 'Bora jogar?', emoji: '🎮', expiresAt: until } })
    expect(await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && !!p.custom)).toMatchObject({ custom: { text: 'Bora jogar?', emoji: '🎮', expiresAt: until } })
    // Skin tones, ZWJ sequences and flags are one emoji.
    gwA.send({ op: 'custom_status', status: { text: '', emoji: '👩🏽‍💻' } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.custom?.emoji === '👩🏽‍💻')
    gwA.send({ op: 'custom_status', status: { text: 'Estudando', emoji: '🇧🇷' } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.custom?.emoji === '🇧🇷')

    // An expired one is not served in READY.
    gwA.send({ op: 'custom_status', status: { text: 'velho', expiresAt: Date.now() + 1200 } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.custom?.text === 'velho')
    await new Promise((r) => setTimeout(r, 1500))
    const late = await connect(s.port, b.token)
    expect((await late.waitFor('READY')).presences.find((p) => p.userId === a.user.id)).not.toHaveProperty('custom')

    gwA.send({ op: 'custom_status', status: { text: 'fica' } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.custom?.text === 'fica')
    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'invisible' } })
    expect(await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'offline')).not.toHaveProperty('custom')
    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'online' } })

    gwA.send({ op: 'custom_status', status: { text: 'two emoji', emoji: '🎮x' } })
    expect((await gwA.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    for (const g of [gwB, late]) g.close()
  })
})
