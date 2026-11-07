import { describe, expect, it } from 'vitest'
import type { CinemaEpisode } from '../../../../../shared/bridge'
import { continueFrom, seasonsOf } from './series'

const ep = (fileId: string, season: number, episode: number, watched = false): CinemaEpisode => ({ fileId, name: `${fileId}.mkv`, season, episode, title: '', watched })

describe('series', () => {
  it('seasons in order, once each', () => {
    expect(seasonsOf([ep('a', 2, 1), ep('b', 0, 1), ep('c', 2, 2), ep('d', 1, 1)])).toEqual([0, 1, 2])
  })
  it('continue: after the last watched, skipping watched ones; nothing when unwatched or already chosen', () => {
    const eps = [ep('a', 1, 1, true), ep('b', 1, 2), ep('c', 1, 3, true), ep('d', 1, 4, true), ep('e', 2, 1)]
    expect(continueFrom(eps, 'a')?.fileId).toBe('e')
    expect(continueFrom(eps, 'e')).toBeNull()
    expect(continueFrom([ep('a', 1, 1), ep('b', 1, 2)], 'a')).toBeNull()
    expect(continueFrom([ep('a', 1, 1, true), ep('b', 1, 2, true)], 'a')).toBeNull()
  })
})
