// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanTitle, nextEpisodes, parseEpisode, seasonDir, seriesOf } from './names'

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
    ['Blade.Runner.2049.2017.2160p.WEB-DL.mkv', 'Blade Runner 2049 (2017)'],
    ['Wonder.Woman.1984.2020.1080p.BluRay.mkv', 'Wonder Woman 1984 (2020)'],
    ['S01E02.mkv', 'S01E02'],
    ['S01E02 - Piloto.mkv', 'Piloto'],
    ['S01E02.Piloto.720p.mkv', 'Piloto'],
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
  it('works for files named by the episode token only', async () => {
    const dir = join(root, 'd')
    mkdirSync(dir)
    mk(dir, 'S01E01 - Piloto.mkv', 'S01E02 - Segundo.mkv', 'S01E03.mkv', 'Show.S01E04.mkv')
    expect(parseEpisode('S01E02 - Piloto.mkv')).toEqual({ season: 1, episode: 2 })
    expect(await nextEpisodes(dir, 'S01E01 - Piloto.mkv')).toEqual([join(dir, 'S01E02 - Segundo.mkv'), join(dir, 'S01E03.mkv')])
  })
  it('empty when current is not an episode, is last, or the folder is missing', async () => {
    const dir = join(root, 'c')
    mkdirSync(dir)
    mk(dir, 'Movie.2020.mkv', 'Show.S01E01.mkv')
    expect(await nextEpisodes(dir, 'Movie.2020.mkv')).toEqual([])
    expect(await nextEpisodes(dir, 'Show.S01E01.mkv')).toEqual([])
    expect(await nextEpisodes(join(root, 'missing'), 'Show.S01E01.mkv')).toEqual([])
  })
  it('crosses season folders next to the current one', async () => {
    const show = join(root, 'Tales of the Walking Dead')
    for (const [d, files] of [['Temporada 1', ['01 - Evie Joe.mkv', '02 - Dee.mkv']], ['Temporada 2', ['Ep 01.mkv']], ['Extras', ['01 - Making of.mkv']]] as const) {
      mkdirSync(join(show, d), { recursive: true })
      mk(join(show, d), ...files)
    }
    expect(await nextEpisodes(join(show, 'Temporada 1'), '02 - Dee.mkv')).toEqual([join(show, 'Temporada 2', 'Ep 01.mkv')])
  })
})

describe('seasonDir', () => {
  it.each([
    ['Temporada 1', 1], ['Season 02', 2], ['S3', 3], ['T04', 4], ['2ª Temporada', 2], ['Season 1 (2022)', 1], ['Show S01', 1],
  ])('%s -> %i', (name, season) => expect(seasonDir(name)?.season).toBe(season))
  it.each(['Extras', 'Series', 'Matrix 2', '1080p', 'Downloads'])('%s -> null', (name) => expect(seasonDir(name)).toBeNull())
})

describe('seriesOf', () => {
  const root = mkdtempSync(join(tmpdir(), 'alga-series-test-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const mk = (dir: string, ...names: string[]) => {
    mkdirSync(dir, { recursive: true })
    names.forEach((n) => writeFileSync(join(dir, n), ''))
  }

  it('season folders with bare numbers: show from the folder, titles from the names, every season', async () => {
    const show = join(root, 'Tales of the Walking Dead')
    mk(join(show, 'Temporada 1'), '02 - Dee.mkv', '01 - Evie Joe.1080p.mkv', 'notes.txt')
    mk(join(show, 'Temporada 2'), 'E01.mkv')
    mk(join(show, 'Extras'), '01 - Making of.mkv')
    const s = await seriesOf(join(show, 'Temporada 1', '02 - Dee.mkv'))
    expect(s?.show).toBe('Tales of the Walking Dead')
    expect(s?.fromFolder).toBe(true)
    expect(s?.current).toBe(1)
    expect(s?.episodes.map((e) => [e.season, e.episode, e.title])).toEqual([[1, 1, 'Evie Joe'], [1, 2, 'Dee'], [2, 1, '']])
  })
  it('a file next to season folders sees them; S01E02 names keep their own season', async () => {
    const show = join(root, 'Show')
    mk(show, 'Show.S01E01.Pilot.720p.mkv')
    mk(join(show, 'Season 2'), 'Show.S02E01.mkv', 'Show.S02E02.mkv')
    const s = await seriesOf(join(show, 'Show.S01E01.Pilot.720p.mkv'))
    expect(s?.show).toBe('Show')
    expect(s?.fromFolder).toBe(false)
    expect(s?.episodes.map((e) => `${e.season}x${e.episode}:${e.title}`)).toEqual(['1x1:Pilot', '2x1:', '2x2:'])
  })
  it('season folders of two shows side by side do not mix', async () => {
    const lib = join(root, 'lib')
    mk(join(lib, 'Alpha S01'), 'E01.mkv', 'E02.mkv')
    mk(join(lib, 'Beta S01'), 'E01.mkv', 'E02.mkv', 'E03.mkv')
    const s = await seriesOf(join(lib, 'Alpha S01', 'E01.mkv'))
    expect(s?.episodes.map((e) => e.path)).toEqual([join(lib, 'Alpha S01', 'E01.mkv'), join(lib, 'Alpha S01', 'E02.mkv')])
  })
  it('a film, a lone episode, or a bare number outside a season folder is no series', async () => {
    const d = join(root, 'loose')
    mk(d, 'Movie.2020.mkv', '01 - Something.mkv', '02 - Other.mkv', 'Lone.S01E01.mkv')
    expect(await seriesOf(join(d, 'Movie.2020.mkv'))).toBeNull()
    expect(await seriesOf(join(d, '01 - Something.mkv'))).toBeNull()
    expect(await seriesOf(join(d, 'Lone.S01E01.mkv'))).toBeNull()
  })
})
