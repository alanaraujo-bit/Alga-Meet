import { describe, expect, it } from 'vitest'
import { CINEMA_ITEMS_PER_FRAME, CINEMA_LANES, CINEMA_MAX_FRAME_BYTES, CINEMA_REACTIONS, CinemaClientFrameSchema, positionAt, type CinemaPlayback } from './cinema.js'
import { uuidv7 } from './ids.js'

const pb = (o: Partial<CinemaPlayback> = {}): CinemaPlayback => ({
  playing: true, position: 100, at: 1_000, seq: 1, by: null, reason: 'user', waitingFor: [], countdown: false, ...o,
})

describe('positionAt', () => {
  it('advances in real time while playing', () => expect(positionAt(pb(), 3_500, 7200)).toBe(102.5))
  it('holds the position before a scheduled command', () => expect(positionAt(pb(), 500, 7200)).toBe(100))
  it('holds the position while paused', () => expect(positionAt(pb({ playing: false }), 9_000, 7200)).toBe(100))
  it('clamps to [0, durationS]', () => {
    expect(positionAt(pb(), 1_000_000, 120)).toBe(120)
    expect(positionAt(pb({ position: -5, playing: false }), 0, 120)).toBe(0)
  })
})

const id = uuidv7()
const film = {
  title: 'Filme', durationS: 7200, width: 1920, height: 1080, hdr: 'sdr', videoCodec: 'h264', videoMime: 'video/mp4; codecs="avc1.640028"',
  bitrateKbps: 8000,
  audio: [{ id: 1, lang: 'por', title: null, sourceCodec: 'eac3', channels: 6, out: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"', default: true }],
  subtitles: [{ id: 2, lang: 'por', title: null, format: 'vtt', external: false }],
  chapters: [{ startS: 0, title: 'Inicio' }], episode: null,
}
const piece = [-1, 0, 1000, 'a'.repeat(64)]
const ok = {
  cinema_time: { op: 'cinema_time', c: 1234.5 },
  cinema_hello: { op: 'cinema_hello' },
  cinema_open: { op: 'cinema_open', channelId: id, film, startS: 0 },
  cinema_pieces: { op: 'cinema_pieces', sessionId: id, track: 'v', from: 0, items: [piece] },
  cinema_film: { op: 'cinema_film', sessionId: id, title: 'Novo', addSubtitle: { id: 3, lang: null, title: null, format: 'ass', external: true } },
  cinema_seat: { op: 'cinema_seat', sessionId: id, seated: true },
  cinema_status: { op: 'cinema_status', sessionId: id, status: 'ready', aheadS: 12 },
  cinema_control: { op: 'cinema_control', sessionId: id, action: 'seek', position: 30, target: id, seq: 4 },
  cinema_options: { op: 'cinema_options', sessionId: id, controlLock: true },
  cinema_signal: { op: 'cinema_signal', sessionId: id, to: id, signal: { kind: 'ice', candidates: ['c'] } },
  cinema_react: { op: 'cinema_react', sessionId: id, emoji: CINEMA_REACTIONS[0] },
  cinema_end: { op: 'cinema_end', sessionId: id },
  cinema_switch: { op: 'cinema_switch', sessionId: id, film, startS: 12 },
}
const parse = (v: unknown) => CinemaClientFrameSchema.safeParse(v).success
const bad = (o: object, patch: object) => ({ ...o, ...patch })

describe('CinemaClientFrameSchema', () => {
  for (const [op, frame] of Object.entries(ok)) it(`accepts ${op}`, () => expect(parse(frame)).toBe(true))

  it('rejects bad titles', () => {
    expect(parse(bad(ok.cinema_open, { film: { ...film, title: '' } }))).toBe(false)
    expect(parse(bad(ok.cinema_open, { film: { ...film, title: 'x'.repeat(121) } }))).toBe(false)
    expect(parse(bad(ok.cinema_film, { title: '' }))).toBe(false)
  })
  it('rejects negative or non-finite positions', () => {
    expect(parse(bad(ok.cinema_open, { startS: -1 }))).toBe(false)
    expect(parse(bad(ok.cinema_switch, { startS: -1 }))).toBe(false)
    expect(parse(bad(ok.cinema_switch, { startS: Infinity }))).toBe(false)
    expect(parse(bad(ok.cinema_switch, { film: { ...film, title: '' } }))).toBe(false)
    expect(parse(bad(ok.cinema_control, { position: Number.NaN }))).toBe(false)
    expect(parse(bad(ok.cinema_control, { position: Infinity }))).toBe(false)
    expect(parse(bad(ok.cinema_time, { c: Infinity }))).toBe(false)
  })
  it('bounds the film duration at 24 h in open and switch', () => {
    for (const op of ['cinema_open', 'cinema_switch'] as const) {
      expect(parse(bad(ok[op], { film: { ...film, durationS: 86_400 } }))).toBe(true)
      expect(parse(bad(ok[op], { film: { ...film, durationS: 86_400.001 } }))).toBe(false)
      expect(parse(bad(ok[op], { film: { ...film, durationS: 1e15 } }))).toBe(false)
    }
  })
  it('limits pieces', () => {
    expect(parse(bad(ok.cinema_pieces, { items: Array(120).fill(piece) }))).toBe(true)
    expect(parse(bad(ok.cinema_pieces, { items: Array(121).fill(piece) }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[-2, 0, 1000, 'a'.repeat(64)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[0, -1, 1000, 'a'.repeat(64)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[0, 0, 0, 'a'.repeat(64)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[0, 0, 64 * 1024 * 1024 + 1, 'a'.repeat(64)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[0, 0, 1, 'A'.repeat(64)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { items: [[0, 0, 1, 'a'.repeat(63)]] }))).toBe(false)
    expect(parse(bad(ok.cinema_pieces, { from: -1 }))).toBe(false)
  })
  it('fits a worst-case piece batch in the frame cap', () => {
    const items = Array(CINEMA_ITEMS_PER_FRAME).fill([1.2345678901234567e-308, 1.2345678901234567e-308, 67108864, 'a'.repeat(64)])
    const frame = { op: 'cinema_pieces', sessionId: id, track: 'poster', from: 0, items }
    expect(parse(frame)).toBe(true)
    expect(JSON.stringify(frame).length).toBeLessThan(CINEMA_MAX_FRAME_BYTES)
  })
  it('validates track ids', () => {
    for (const t of ['a0', 'a1', 's3', 'poster', 'thumbs', 'v']) expect(parse(bad(ok.cinema_pieces, { track: t }))).toBe(true)
    for (const t of ['a-1', 'x', 'a', 'v1', '']) expect(parse(bad(ok.cinema_pieces, { track: t }))).toBe(false)
  })
  it('rejects emoji outside the list', () => expect(parse(bad(ok.cinema_react, { emoji: '💩' }))).toBe(false))
  it('limits signals', () => {
    expect(parse(bad(ok.cinema_signal, { signal: { kind: 'ice', candidates: Array(21).fill('c') } }))).toBe(false)
    expect(parse(bad(ok.cinema_signal, { signal: { kind: 'offer', sdp: 'x'.repeat(12_000) } }))).toBe(true)
    expect(parse(bad(ok.cinema_signal, { signal: { kind: 'offer', sdp: 'x'.repeat(12_001) } }))).toBe(false)
  })
  it('keeps the lane of a signal (0..CINEMA_LANES-1) and refuses others', () => {
    const lane = (signal: object) => CinemaClientFrameSchema.safeParse(bad(ok.cinema_signal, { signal }))
    const r = lane({ kind: 'ice', candidates: ['c'], lane: 2 })
    expect(r.success && r.data.op === 'cinema_signal' && r.data.signal.lane).toBe(2)
    expect(lane({ kind: 'answer', sdp: 'x', lane: CINEMA_LANES - 1 }).success).toBe(true)
    expect(lane({ kind: 'offer', sdp: 'x', lane: CINEMA_LANES }).success).toBe(false)
    expect(lane({ kind: 'ice', candidates: [], lane: 1.5 }).success).toBe(false)
  })
  it('requires uuids and integer seq', () => {
    expect(parse(bad(ok.cinema_seat, { sessionId: 'nope' }))).toBe(false)
    expect(parse(bad(ok.cinema_control, { seq: -1 }))).toBe(false)
    expect(parse(bad(ok.cinema_control, { seq: 1.5 }))).toBe(false)
  })
})
