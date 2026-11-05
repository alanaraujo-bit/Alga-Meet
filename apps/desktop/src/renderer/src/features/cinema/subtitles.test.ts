import { describe, expect, it } from 'vitest'
import { activeCues, parseSrt, parseVtt, parseInline } from './subtitles'

describe('parseSrt', () => {
  it('parses indices, comma decimals, multi-line text and extra blank lines', () => {
    const src = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nOlá <i>mundo</i>\r\nsegunda linha\r\n\r\n\r\n\r\n2\r\n01:00:00,250 --> 01:00:02,000\r\nFim\r\n'
    expect(parseSrt(src)).toEqual([
      { startS: 1.5, endS: 3, text: 'Olá <i>mundo</i>\nsegunda linha' },
      { startS: 3600.25, endS: 3602, text: 'Fim' },
    ])
  })
  it('empty or garbage input gives []', () => {
    expect(parseSrt('')).toEqual([])
    expect(parseSrt('not a subtitle')).toEqual([])
  })
})

describe('parseVtt', () => {
  it('skips header/notes/styles, handles ids, cue settings and short timestamps', () => {
    const src = 'WEBVTT - title\n\nNOTE comment\nmore\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.000 --> 00:02.500 align:start position:10%\n<b>Hi</b>\n\n00:00:03.000 --> 00:00:04.000\nBye\n'
    expect(parseVtt(src)).toEqual([
      { startS: 1, endS: 2.5, text: '<b>Hi</b>' },
      { startS: 3, endS: 4, text: 'Bye' },
    ])
  })
  it('empty gives []', () => expect(parseVtt('')).toEqual([]))
})

describe('activeCues', () => {
  const cues = [{ startS: 1, endS: 2, text: 'a' }, { startS: 2, endS: 3, text: 'b' }]
  it('selects by time, end exclusive', () => {
    expect(activeCues(cues, 1.5, 0).map((c) => c.text)).toEqual(['a'])
    expect(activeCues(cues, 2, 0).map((c) => c.text)).toEqual(['b'])
    expect(activeCues(cues, 3, 0)).toEqual([])
  })
  it('positive offset delays the subtitle', () => {
    expect(activeCues(cues, 1.2, 0.5)).toEqual([])
    expect(activeCues(cues, 1.6, 0.5).map((c) => c.text)).toEqual(['a'])
  })
  it('empty list is fine', () => expect(activeCues([], 5, 0)).toEqual([]))
})

describe('parseInline', () => {
  it('keeps i/b/u, strips other tags, never emits raw html', () => {
    expect(parseInline('a <i>b</i> <font color="red">c</font> <script>x</script>')).toEqual([
      { text: 'a ' },
      { text: 'b', i: true },
      { text: ' ' },
      { text: 'c' },
      { text: ' ' },
      { text: 'x' },
    ])
  })
  it('nests and tolerates unclosed tags', () => {
    expect(parseInline('<b><i>x</i>y')).toEqual([{ text: 'x', b: true, i: true }, { text: 'y', b: true }])
  })
})
