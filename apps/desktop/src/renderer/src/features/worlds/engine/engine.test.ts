import { describe, expect, it } from 'vitest'
import { PERSON_RADIUS, isFree, resolve, slide, standBy, turn, type Bounds, type Box } from './collision'
import { PoseSender, PoseTrack, RENDER_DELAY_MS } from './net'
import { BACKGROUND_FPS, QualityGovernor, TIERS, frameBudget } from './quality'

const ROOM: Bounds = { hw: 5, hd: 4 }
const R = PERSON_RADIUS

describe('walking around furniture', () => {
  const table: Box = { x: 0, z: 0, hw: 1, hd: 0.5, rot: 0 }

  it('keeps a person inside the walls', () => {
    expect(resolve(9, -9, R, ROOM, [])).toEqual([5 - R, -4 + R])
    expect(resolve(1, 1, R, ROOM, [])).toEqual([1, 1])
  })

  it('pushes a person out of a piece through its nearest face', () => {
    const [x, z] = resolve(0.2, 0.45, R, ROOM, [table])
    expect(x).toBeCloseTo(0.2)
    expect(z).toBeCloseTo(0.5 + R)
    expect(isFree(x, z, R, ROOM, [table])).toBe(true)
    expect(isFree(0, 0, R, ROOM, [table])).toBe(false)
  })

  it('slides along a piece instead of stopping at it', () => {
    // Walking diagonally into the long side of the table: the sideways part of the step survives.
    let x = -0.5, z = 1.2
    for (let i = 0; i < 60; i++) [x, z] = slide(x, z, 0.02, -0.02, R, ROOM, [table])
    expect(z).toBeCloseTo(0.5 + R, 2)
    expect(x).toBeGreaterThan(0.4)
  })

  it('does not jump through a thin piece on a long frame', () => {
    const shelf: Box = { x: 0, z: 0, hw: 2, hd: 0.05, rot: 0 }
    const [, z] = slide(0, 1, 0, -3, R, ROOM, [shelf])
    expect(z).toBeGreaterThan(0.05)
  })

  it('follows the rotation of a piece', () => {
    const turned: Box = { x: 0, z: 0, hw: 1, hd: 0.2, rot: Math.PI / 2 }
    // Rotated a quarter turn, the long side runs along Z.
    expect(isFree(0.6, 0, R, ROOM, [turned])).toBe(true)
    expect(isFree(0, 0.9, R, ROOM, [turned])).toBe(false)
  })

  it('finds where to stand in front of a seat, or beside it when the front is taken', () => {
    const [fx, fz] = standBy(0, 0, 0, R, ROOM, [])
    expect(fx).toBeCloseTo(0)
    expect(fz).toBeCloseTo(0.62)
    const tableInFront: Box = { x: 0, z: 0.75, hw: 0.6, hd: 0.3, rot: 0 }
    const [sx, sz] = standBy(0, 0, 0, R, ROOM, [tableInFront])
    expect(isFree(sx, sz, R, ROOM, [tableInFront])).toBe(true)
    expect(Math.abs(sx)).toBeGreaterThan(0.3)
  })

  it('turns the short way round', () => {
    expect(turn(0.1, -0.1)).toBeCloseTo(-0.2)
    expect(turn(3, -3)).toBeCloseTo(Math.PI * 2 - 6)
    expect(turn(-3, 3)).toBeCloseTo(-(Math.PI * 2 - 6))
  })
})

describe('other people between two poses', () => {
  it('draws them a little in the past, between the poses around that moment', () => {
    const t = new PoseTrack()
    t.push(1000, 0, 0, 0, 1)
    t.push(1100, 1, 0, 0, 1)
    const s = t.sample(1050 + RENDER_DELAY_MS)!
    expect(s.x).toBeCloseTo(0.5)
    expect(s.gait).toBe(1)
    expect(s.speed).toBeCloseTo(10)
  })

  it('turns through the short side and never the long one', () => {
    const t = new PoseTrack()
    t.push(0, 0, 0, 3.0, 0)
    t.push(100, 0, 0, -3.0, 0)
    const yaw = t.sample(50 + RENDER_DELAY_MS)!.yaw
    expect(Math.abs(yaw)).toBeGreaterThan(3.0)
  })

  it('keeps going for a moment without news, then stands still where it was last seen', () => {
    const t = new PoseTrack()
    t.push(0, 0, 0, 0, 1)
    t.push(100, 0.15, 0, 0, 1)
    const soon = t.sample(100 + RENDER_DELAY_MS + 60)!
    expect(soon.x).toBeGreaterThan(0.15)
    expect(soon.gait).toBe(1)
    const late = t.sample(100 + RENDER_DELAY_MS + 2000)!
    expect(late).toMatchObject({ x: 0.15, gait: 0, speed: 0 })
  })

  it('snaps when the server places someone', () => {
    const t = new PoseTrack()
    t.push(0, 0, 0, 0, 1)
    t.snap(10, 4, 4, 1)
    expect(t.sample(11)).toMatchObject({ x: 4, z: 4, yaw: 1, gait: 0 })
    expect(new PoseTrack().sample(0)).toBeNull()
  })

  it('sends my pose only when it changed, at most a few times a second, and once more when I stop', () => {
    const s = new PoseSender(10)
    expect(s.next(1000, [0, 0, 0, 1])).toEqual([0, 0, 0, 1])
    expect(s.next(1050, [5, 0, 0, 1])).toBeNull() // too soon
    expect(s.next(1100, [5, 0, 0, 1])).toEqual([5, 0, 0, 1])
    expect(s.next(1200, [5, 0, 0, 1])).toBeNull() // nothing new
    expect(s.next(1300, [5, 0, 2, 1])).toBeNull() // a couple of degrees is not news
    expect(s.next(1400, [5, 0, 0, 0])).toEqual([5, 0, 0, 0]) // stopped
  })
})

describe('what the room may cost', () => {
  it('does not draw when hidden and slows right down when another window is in use', () => {
    expect(frameBudget('high', { visible: false, focused: true, reducedMotion: false })).toBe(0)
    expect(frameBudget('high', { visible: true, focused: false, reducedMotion: false })).toBe(BACKGROUND_FPS)
    expect(frameBudget('high', { visible: true, focused: true, reducedMotion: false })).toBe(TIERS.high.fps)
    expect(frameBudget('high', { visible: true, focused: true, reducedMotion: true })).toBe(30)
    expect(frameBudget('low', { visible: true, focused: true, reducedMotion: false })).toBe(TIERS.low.fps)
  })

  it('steps down when frames keep missing their budget, and not on a single slow frame', () => {
    const g = new QualityGovernor('high')
    let now = 2000
    expect(g.frame(60, now)).toBeNull()
    for (let i = 0; i < 20; i++) expect(g.frame(8, (now += 16))).toBeNull()
    let changed: string | null = null
    for (let i = 0; i < 200 && !changed; i++) changed = g.frame(30, (now += 33))
    expect(changed).toBe('medium')
    expect(g.tier).toBe('medium')
  })

  it('steps up only with plenty of room for a while, and does not go back to a tier that just failed', () => {
    const g = new QualityGovernor('medium')
    let now = 2000
    let changed: string | null = null
    for (let i = 0; i < 1000 && !changed; i++) changed = g.frame(3, (now += 16))
    expect(changed).toBe('high')
    // High cannot keep up: back to medium, and stays there although medium has room again.
    changed = null
    now += 2000
    for (let i = 0; i < 300 && !changed; i++) changed = g.frame(40, (now += 40))
    expect(changed).toBe('medium')
    changed = null
    now += 2000
    for (let i = 0; i < 1500 && !changed; i++) changed = g.frame(3, (now += 16))
    expect(changed).toBeNull()
  })

  it('never goes past its ceiling', () => {
    const g = new QualityGovernor('high', 'medium')
    expect(g.tier).toBe('medium')
    let now = 2000
    for (let i = 0; i < 2000; i++) expect(g.frame(2, (now += 16))).toBeNull()
  })
})
