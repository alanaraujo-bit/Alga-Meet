// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanTitle, nextEpisodes, parseEpisode } from './names'

describe('cleanTitle', () => {
  it.each([
    ['Duna.Parte.Dois.2024.2160p.WEB-DL.DDP5.1.HDR.mkv', 'Duna Parte Dois (2024)'],
    ['The.Office.US.S02E03.720p.mkv', 'The Office US'],
    ['filme_caseiro.mp4', 'filme caseiro'],
    ['Movie (2019) [1080p] x264-GROUP.mkv', 'Movie (2019)'],
    ['[SubGroup] Some Show - 1x05 - Title.mkv', 'Some Show'],
    ['Show - S01E02 - Pilot.mp4', 'Show'],
    ['Spider-Man.No.Way.Home.2021.BluRay.x265.mkv', 'Spider-Man No Way Home (2021)'],
    ['2012.2009.1080p.mkv', '2012 (2009)'],
    ['no extension', 'no extension'],
    ['1080p.mkv', '1080p'],
    ['...mkv', 'Filme'],
    ['\u0000\u0007.mkv', 'Filme'],
  ])('%s -> %s', (input, out) => expect(cleanTitle(input)).toBe(out))

  it('never returns control characters or more than 120 chars', () => {
    expect(cleanTitle('a\u0000b‮c.mkv')).toBe('ab‮c')
    expect(cleanTitle(`${'word '.repeat(100)}.mkv`).length).toBeLessThanOrEqual(120)
  })
})

describe('parseEpisode', () => {
  it.each([
    ['Show.S01E02.mkv', { season: 1, episode: 2 }],
    ['show s1e2 x.mkv', { season: 1, episode: 2 }],
    ['Show.1x02.mkv', { season: 1, episode: 2 }],
    ['Show.S10E123.mkv', { season: 10, episode: 123 }],
    ['Show S01E02E03.mkv', { season: 1, episode: 2 }],
    ['Show.S00E01.mkv', { season: 0, episode: 1 }],
  ])('%s', (name, ep) => expect(parseEpisode(name)).toEqual(ep))

  it.each(['2024.1080p.mkv', 'Movie.1920x1080.mkv', 'Movie.x264.mkv', 'Moses01E.mkv', 'plain.mp4'])('%s -> null', (name) =>
    expect(parseEpisode(name)).toBeNull())
})

describe('nextEpisodes', () => {
  const root = mkdtempSync(join(tmpdir(), 'alga-names-test-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const mk = (dir: string, ...names: string[]) => names.forEach((n) => writeFileSync(join(dir, n), ''))

  it('same folder, same show, video files only, sorted, after the current one', async () => {
    const dir = join(root, 'a')
    mkdirSync(dir)
    mk(dir, 'Show.S01E03.mp4', 'Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E02.srt', 'Other.Show.S01E02.mkv', 'Show.2019.S01E01.720p.mkv', 'notes.txt', 'Movie.2020.mkv')
    mkdirSync(join(dir, 'Show.S01E04.mkv')) // a directory with a video-like name
    mkdirSync(join(dir, 'sub'))
    mk(join(dir, 'sub'), 'Show.S01E05.mkv') // never recurse
    expect(await nextEpisodes(dir, 'Show.S01E01.mkv')).toEqual([join(dir, 'Show.S01E02.mkv'), join(dir, 'Show.S01E03.mp4')])
  })
  it('crosses seasons in (season, episode) order and accepts a full path as current', async () => {
    const dir = join(root, 'b')
    mkdirSync(dir)
    mk(dir, 'Show.S02E01.mkv', 'Show.S01E10.mkv', 'Show.S01E09.mkv', 'Show.S01E02.mkv')
    expect(await nextEpisodes(dir, join(dir, 'Show.S01E09.mkv'))).toEqual([join(dir, 'Show.S01E10.mkv'), join(dir, 'Show.S02E01.mkv')])
  })
  it('empty when current is not an episode, is last, or the folder is missing', async () => {
    const dir = join(root, 'c')
    mkdirSync(dir)
    mk(dir, 'Movie.2020.mkv', 'Show.S01E01.mkv')
    expect(await nextEpisodes(dir, 'Movie.2020.mkv')).toEqual([])
    expect(await nextEpisodes(dir, 'Show.S01E01.mkv')).toEqual([])
    expect(await nextEpisodes(join(root, 'missing'), 'Show.S01E01.mkv')).toEqual([])
  })
})
