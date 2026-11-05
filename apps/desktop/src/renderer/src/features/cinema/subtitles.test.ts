import { describe, expect, it } from 'vitest'
import { activeCues, assTimeOffset, parseSrt, parseVtt, parseInline } from './subtitles'

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

describe('cue text cleanup', () => {
  it('splits on separator lines holding only spaces or tabs', () => {
    expect(parseSrt('1\n00:00:01,000 --> 00:00:02,000\nUm\n \t\n2\n00:00:03,000 --> 00:00:04,000\nDois\n')).toEqual([
      { startS: 1, endS: 2, text: 'Um' },
      { startS: 3, endS: 4, text: 'Dois' },
    ])
  })
  it('drops ASS override tags and VTT inline timestamps', () => {
    expect(parseSrt(String.raw`1
00:00:01,000 --> 00:00:02,000
{\an8}{\i1}No alto`)[0]!.text).toBe('No alto')
    expect(parseVtt('WEBVTT\n\n00:01.000 --> 00:03.000\n<00:01.000>Ka<00:01.500>ra<00:00:02.000>ô\n')[0]!.text).toBe('Karaô')
  })
  it('decodes basic HTML entities as text, never as tags', () => {
    expect(parseInline('Tom &amp; Jerry &lt;i&gt;&quot;oi&quot;&#39;s&nbsp;x')).toEqual([{ text: 'Tom & Jerry <i>"oi"\'s\u00a0x' }])
  })
})

describe('assTimeOffset', () => {
  it('maps a delay (positive offsetS, as activeCues reads it) to JASSUB drawing at mediaTime + timeOffset', () => {
    const cues = [{ startS: 10, endS: 11, text: 'x' }]
    const offsetS = 0.5
    // text overlay: at t = 10.6 the cue shows (10.6 - 0.5 = 10.1)
    expect(activeCues(cues, 10.6, offsetS)).toHaveLength(1)
    // ASS: libass is asked for mediaTime + timeOffset = the same 10.1 s
    expect(10.6 + assTimeOffset(offsetS)).toBeCloseTo(10.1, 9)
  })
})
