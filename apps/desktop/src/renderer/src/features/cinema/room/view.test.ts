import type { CinemaPlayback, CinemaSessionView } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { BUFFERING_GRACE_MS, INTERMISSION_MS, creditsAt, roomView, splitTitle } from './view'

const NOW = 1_000_000
const session = (p: Partial<CinemaPlayback> = {}): CinemaSessionView => ({
  sessionId: 's', channelId: 'c', hostId: 'host', createdAt: 0, iceServers: [], heat: [],
  options: { controlLock: false, waitForStalled: true },
  seats: [{ userId: 'me', status: 'ready', aheadS: 5, direct: true }],
  film: {
    title: 'Duna', durationS: 6000, width: 1920, height: 804, hdr: 'sdr', videoCodec: 'h264', videoMime: '', bitrateKbps: 8000,
    audio: [], subtitles: [], chapters: [], episode: null,
  },
  playback: { playing: true, position: 100, at: NOW - 5000, seq: 3, by: 'pedro', reason: 'user', waitingFor: [], countdown: false, ...p },
})
const base: Omit<Parameters<typeof roomView>[0], 'session'> = { seated: true, draft: false, ended: false, serverNow: NOW, pausedSince: null, durationS: 6000, creditsAtS: null, position: 100 }
const view = (p: Partial<CinemaPlayback> = {}, o: Partial<typeof base> = {}) => roomView({ ...base, session: session(p), ...o })

describe('roomView', () => {
  it('no session: the sheet while the host has a draft, else nothing to show but the card', () => {
    expect(roomView({ ...base, session: null, draft: true })).toMatchObject({ screen: 'sheet', lights: 'on' })
    expect(roomView({ ...base, session: null })).toMatchObject({ screen: 'card', lights: 'on' })
  })

  it('a session I am not seated in is the card, whatever it plays', () => {
    expect(view({}, { seated: false })).toMatchObject({ screen: 'card', lights: 'on' })
    expect(view({ playing: false, reason: 'foyer' }, { seated: false }).screen).toBe('card')
  })

  it('foyer: lights on', () => {
    expect(view({ playing: false, reason: 'foyer' })).toEqual({ screen: 'foyer', lights: 'on', who: null, nextUpS: null })
  })

  it('countdown until `at`, then watching; both dark', () => {
    expect(view({ countdown: true, at: NOW + 2000 })).toMatchObject({ screen: 'countdown', lights: 'dim' })
    expect(view({ countdown: true, at: NOW - 1 })).toMatchObject({ screen: 'watching', lights: 'dim' })
  })

  it('playing: watching, dim', () => {
    expect(view()).toEqual({ screen: 'watching', lights: 'dim', who: null, nextUpS: null })
  })

  it('credits from the credits chapter, else the last 30 s; nextUpS counts 10 s from there', () => {
    expect(view({}, { creditsAtS: 5000, position: 5004 })).toEqual({ screen: 'credits', lights: 'dim', who: null, nextUpS: 6 })
    expect(view({}, { creditsAtS: 5000, position: 4999 }).screen).toBe('watching')
    expect(view({}, { position: 5970 })).toMatchObject({ screen: 'credits', nextUpS: 10 })
    expect(view({}, { position: 5969 }).screen).toBe('watching')
    expect(view({}, { position: 5995 }).nextUpS).toBe(0)
  })

  it('paused by someone: half light with who paused', () => {
    expect(view({ playing: false, reason: 'user', by: 'pedro' }, { pausedSince: NOW - 60_000 })).toEqual({ screen: 'paused', lights: 'half', who: 'pedro', nextUpS: null })
  })

  it('a pause longer than 3 min is the intermission (lights on)', () => {
    expect(view({ playing: false, by: 'ana' }, { pausedSince: NOW - INTERMISSION_MS - 1 })).toMatchObject({ screen: 'intermission', lights: 'on', who: 'ana' })
    expect(view({ playing: false }, { pausedSince: NOW - INTERMISSION_MS }).screen).toBe('paused')
    expect(view({ playing: false }, { pausedSince: null }).screen).toBe('paused')
  })

  it('waiting for someone: half light, who = the first waited for', () => {
    expect(view({ playing: false, reason: 'waiting', waitingFor: ['ana', 'bia'] })).toEqual({ screen: 'waiting', lights: 'half', who: 'ana', nextUpS: null })
  })

  it('host away: paused at half light, who = the host', () => {
    expect(view({ playing: false, reason: 'host_away', by: null })).toMatchObject({ screen: 'paused', lights: 'half', who: 'host' })
  })

  it('start/seek preparing: dark at once, the waiting screen only after the grace', () => {
    expect(view({ playing: false, reason: 'buffering', at: NOW - 200 })).toMatchObject({ screen: 'watching', lights: 'dim' })
    expect(view({ playing: false, reason: 'buffering', at: NOW - BUFFERING_GRACE_MS - 1 })).toMatchObject({ screen: 'waiting', lights: 'half', who: null })
  })

  it('ended: rising lights, over anything else', () => {
    expect(view({}, { ended: true })).toEqual({ screen: 'ended', lights: 'rising', who: null, nextUpS: null })
    expect(roomView({ ...base, session: null, ended: true }).screen).toBe('ended')
  })

  describe('review focus 1', () => {
    it('a pause during the countdown is a pause (not a countdown)', () => {
      expect(view({ playing: false, countdown: false, at: NOW + 2000, by: 'bia' }, { pausedSince: NOW + 2000 })).toMatchObject({ screen: 'paused', lights: 'half', who: 'bia' })
    })
    it('a stall during the intermission is the waiting screen, not the intermission', () => {
      expect(view({ playing: false, reason: 'waiting', waitingFor: ['lucas'] }, { pausedSince: NOW - 10 * 60_000 })).toMatchObject({ screen: 'waiting', who: 'lucas' })
      expect(view({ playing: false, reason: 'buffering', at: NOW - 5000 }, { pausedSince: NOW - 10 * 60_000 }).screen).toBe('waiting')
    })
    it('the session ending in the foyer is the end', () => {
      expect(view({ playing: false, reason: 'foyer' }, { ended: true })).toMatchObject({ screen: 'ended', lights: 'rising' })
    })
  })
})

describe('creditsAt', () => {
  it('finds a credits chapter by name, else null', () => {
    expect(creditsAt([{ startS: 0, title: 'Abertura' }, { startS: 5400, title: 'Créditos' }])).toBe(5400)
    expect(creditsAt([{ startS: 0, title: 'Intro' }, { startS: 5000, title: 'End Credits' }])).toBe(5000)
    expect(creditsAt([{ startS: 0, title: 'Capítulo 1' }])).toBeNull()
    expect(creditsAt([])).toBeNull()
  })
})

describe('splitTitle', () => {
  it('splits a trailing year', () => {
    expect(splitTitle('Duna Parte Dois (2024)')).toEqual({ name: 'Duna Parte Dois', year: '2024' })
    expect(splitTitle('Sem ano')).toEqual({ name: 'Sem ano', year: null })
    expect(splitTitle('(2024)')).toEqual({ name: '(2024)', year: null })
  })
})
