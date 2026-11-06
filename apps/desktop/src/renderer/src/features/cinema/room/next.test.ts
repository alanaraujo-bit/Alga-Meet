import { describe, expect, it } from 'vitest'
import { END_EPSILON_S, episodeLabel, nextStep } from './next'
import { creditsAt, roomView } from './view'

const base: Parameters<typeof nextStep>[0] = {
  screen: 'credits', nextUpS: 10, position: 5970, durationS: 6000, playing: true,
  hasNext: true, preparing: false, prepared: false, cancelled: false, announced: false,
}

describe('next episode', () => {
  it('prepares on entering the credits, once; nothing before them or without a next file', () => {
    expect(nextStep(base)).toBe('prepare')
    expect(nextStep({ ...base, preparing: true })).toBeNull()
    expect(nextStep({ ...base, screen: 'watching' })).toBeNull()
    expect(nextStep({ ...base, hasNext: false })).toBeNull()
    expect(nextStep({ ...base, cancelled: true })).toBeNull()
  })

  it('switches when the 10 s run out, only once prepared and announced', () => {
    const ready = { ...base, prepared: true, announced: true }
    expect(nextStep({ ...ready, nextUpS: 1 })).toBeNull()
    expect(nextStep({ ...ready, nextUpS: 0 })).toBe('switch')
    expect(nextStep({ ...ready, nextUpS: 0, announced: false })).toBeNull()
    expect(nextStep({ ...ready, nextUpS: 0, cancelled: true })).toBeNull()
    expect(nextStep({ ...ready, nextUpS: 4, position: 6000 })).toBe('switch') // credits shorter than 10 s
  })

  it('ends at the very end when there is nothing to switch to', () => {
    const end = { ...base, hasNext: false, position: 6000 - END_EPSILON_S }
    expect(nextStep(end)).toBe('end')
    expect(nextStep({ ...end, position: 5990 })).toBeNull()
    expect(nextStep({ ...end, playing: false })).toBeNull()
    expect(nextStep({ ...end, hasNext: true, cancelled: true })).toBe('end')
  })

  it('timing: 10 s from the credits chapter (else the last 30 s), counted in film time', () => {
    const film = { chapters: [{ startS: 0, title: 'Abertura' }, { startS: 5000, title: 'Créditos' }] }
    const view = (position: number, creditsAtS = creditsAt(film.chapters)) => roomView({
      session: { playback: { playing: true, position, at: 0, seq: 1, by: null, reason: 'user', waitingFor: [], countdown: false } } as never,
      seated: true, draft: false, ended: false, serverNow: 0, pausedSince: null, durationS: 6000, creditsAtS, position,
    })
    expect(view(4999).screen).toBe('watching')
    expect(view(5000).nextUpS).toBe(10)
    expect(view(5009.5).nextUpS).toBe(1)
    expect(view(5010).nextUpS).toBe(0)
    expect(view(5969, null).screen).toBe('watching')
    expect(view(5970, null).nextUpS).toBe(10)
  })

  it('labels', () => {
    expect(episodeLabel({ title: 'A Travessia', episode: { season: 1, episode: 3 } })).toBe('S01E03 — A Travessia')
    expect(episodeLabel({ title: 'Duna Parte Dois (2024)', episode: null })).toBe('Duna Parte Dois (2024)')
  })
})
