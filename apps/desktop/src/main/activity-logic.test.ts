import { describe, expect, it } from 'vitest'
import { classify, exeNameOf, GAMES, initialState, step, STALE_MS, type Sample, type State } from './activity-logic'

const cls = (path: string, over: Partial<{ product: string; desc: string; fs: boolean; manifestName: string }> = {}) =>
  classify({ path, product: '', desc: '', fs: false, exeName: exeNameOf(path), ...over })

describe('classify', () => {
  it('knows at least 60 games', () => {
    expect(GAMES.reduce((n, r) => n + r.length - 2, 0)).toBeGreaterThanOrEqual(60)
    expect(new Set(GAMES.map((r) => r[1])).size).toBeGreaterThanOrEqual(60)
  })
  it('names known exes', () => {
    expect(cls('C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe')).toEqual({ kind: 'game', name: 'VALORANT' })
    expect(cls('D:\\Games\\Plutonium\\t6zm.exe')).toEqual({ kind: 'game', name: 'Call of Duty: Black Ops II' })
    expect(cls('C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')).toEqual({ kind: 'code', name: 'Visual Studio Code' })
    expect(cls('C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe')).toEqual({ kind: 'music', name: 'Spotify' })
    expect(cls('C:\\x\\FiveM_b3258_GTAProcess.exe')).toEqual({ kind: 'game', name: 'FiveM' })
  })
  it('javaw is Minecraft only with a minecraft-ish path', () => {
    expect(cls('C:\\Users\\a\\AppData\\Roaming\\.minecraft\\runtime\\java\\bin\\javaw.exe')).toEqual({ kind: 'game', name: 'Minecraft' })
    expect(cls('C:\\Program Files\\Java\\bin\\javaw.exe')).toEqual({ kind: null, name: 'javaw' })
  })
  it('ignores shell, launchers, crash handlers, installers, ourselves', () => {
    for (const p of [
      'C:\\Windows\\explorer.exe', 'C:\\Windows\\System32\\Taskmgr.exe', 'C:\\Program Files (x86)\\Steam\\steam.exe',
      'C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe', 'D:\\G\\UnityCrashHandler64.exe',
      'D:\\G\\EasyAntiCheat_EOS.exe', 'C:\\Users\\a\\Downloads\\setup.exe', 'C:\\Windows\\SystemApps\\X\\Y.exe',
      'C:\\Users\\a\\AppData\\Local\\Programs\\Alga Meet\\Alga Meet.exe',
    ])
      expect(cls(p)).toBe('ignore')
  })
  it('browsers and messengers are unknown kind', () => {
    expect(cls('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', { fs: true })).toEqual({ kind: null, name: 'Google Chrome' })
    expect(cls('C:\\x\\WhatsApp.exe')).toEqual({ kind: null, name: 'WhatsApp' })
  })
  it('game heuristics: install folders and fullscreen', () => {
    expect(cls('D:\\SteamLibrary\\steamapps\\common\\Hades II\\Ship\\Hades2.exe')).toEqual({ kind: 'game', name: 'Hades II' })
    expect(cls('D:\\SteamLibrary\\steamapps\\common\\Hades II\\Hades2.exe', { product: 'Hades II: Early' })).toEqual({ kind: 'game', name: 'Hades II: Early' })
    expect(cls('C:\\XboxGames\\Forza\\Content\\gamelaunchhelper.exe')).toMatchObject({ kind: 'game', name: 'Forza' })
    expect(cls('C:\\Some\\Thing\\mygame.exe', { fs: true })).toEqual({ kind: 'game', name: 'mygame' })
    expect(cls('C:\\Some\\Thing\\mytool.exe', { product: 'My Tool' })).toEqual({ kind: null, name: 'My Tool' })
  })
  it('name precedence: table > manifest > product > desc > folder > exe; generic product names are skipped', () => {
    const p = 'D:\\steamapps\\common\\Cool Game\\cg.exe'
    expect(cls(p, { manifestName: 'Cool Game: GOTY', product: 'cg' }).valueOf()).toMatchObject({ name: 'Cool Game: GOTY' })
    expect(cls(p, { product: 'UnrealEngine', desc: 'Cool Desc' })).toMatchObject({ name: 'Cool Desc' })
    expect(cls(p, { product: 'Unity' })).toMatchObject({ name: 'Cool Game' })
  })
})

const sample = (over: Partial<Sample> = {}): Sample => ({ pid: 10, key: 'code.exe', name: 'Visual Studio Code', kind: 'code', ignored: false, shown: true, procStart: 0, ...over })
const game = (over: Partial<Sample> = {}) => sample({ pid: 20, key: 'game.exe', name: 'Game', kind: 'game', procStart: 5_000, ...over })
const alive = () => true
/** Run ticks of 1 s from t0 with the same sample; returns the last state. */
function run(st: State, s: Sample | null, from: number, secs: number, idle = 0, isAlive: (p: number) => boolean = alive): State {
  for (let t = 0; t <= secs; t++) st = step(st, s, from + t * 1000, isAlive, idle)
  return st
}

describe('step', () => {
  it('games need 3 s in focus, other apps 8 s', () => {
    expect(run(initialState(), game(), 1000, 2).current).toBeNull()
    expect(run(initialState(), game(), 1000, 3).current?.name).toBe('Game')
    expect(run(initialState(), sample(), 1000, 7).current).toBeNull()
    expect(run(initialState(), sample(), 1000, 8).current?.name).toBe('Visual Studio Code')
  })
  it('startedAt: process start for games (fallback first seen), focus-session start for the rest', () => {
    expect(run(initialState(), game(), 1000, 3).current?.startedAt).toBe(5_000)
    expect(run(initialState(), game({ procStart: 0 }), 1000, 3).current?.startedAt).toBe(1000)
    expect(run(initialState(), sample(), 1000, 8).current?.startedAt).toBe(1000)
  })
  it('unknown kind that was turned on becomes app', () => {
    expect(run(initialState(), sample({ kind: null, key: 'x.exe' }), 0, 8).current?.kind).toBe('app')
  })
  it('alt-tab to ignored/hidden apps keeps the current activity', () => {
    let st = run(initialState(), game(), 0, 3)
    st = run(st, sample({ pid: 1, key: 'alga meet.exe', ignored: true }), 4000, 600)
    st = run(st, sample({ pid: 2, key: 'chrome.exe', kind: null, shown: false }), 700_000, 600)
    st = run(st, null, 1_400_000, 100)
    expect(st.current?.name).toBe('Game')
    expect(st.current?.startedAt).toBe(5_000)
  })
  it('a hidden candidate never becomes current', () => {
    expect(run(initialState(), sample({ shown: false }), 0, 60).current).toBeNull()
  })
  it('game ends when its process dies; non-game apps never watch the pid', () => {
    let st = run(initialState(), game(), 0, 3)
    st = step(st, null, 10_000, (p) => p !== 20, 0)
    expect(st.current).toBeNull()
    let st2 = run(initialState(), sample(), 0, 8)
    st2 = step(st2, null, 10_000, () => false, 0)
    expect(st2.current?.name).toBe('Visual Studio Code')
  })
  it('non-game fades after 15 min out of focus; focus resets the timer', () => {
    const other = sample({ pid: 2, key: 'alga meet.exe', ignored: true })
    let st = run(initialState(), sample(), 0, 8)
    st = step(st, other, 8000 + STALE_MS - 1, alive, 0)
    expect(st.current).not.toBeNull()
    st = step(st, sample(), 8000 + STALE_MS - 1, alive, 0) // refocus just in time
    st = step(st, other, 8000 + STALE_MS - 1 + STALE_MS - 1, alive, 0)
    expect(st.current).not.toBeNull()
    st = step(st, other, 8000 + STALE_MS - 1 + STALE_MS, alive, 0)
    expect(st.current).toBeNull()
  })
  it('system idle: non-game drops (and does not come back until the person returns), game stays', () => {
    let st = run(initialState(), sample(), 0, 8)
    st = step(st, sample(), 9000, alive, STALE_MS)
    expect(st.current).toBeNull()
    st = run(st, sample(), 10_000, 30, STALE_MS)
    expect(st.current).toBeNull()
    st = run(st, sample(), 100_000, 8, 0)
    expect(st.current?.startedAt).toBe(100_000)
    let g = run(initialState(), game(), 0, 3)
    g = run(g, null, 4000, 5, STALE_MS * 4)
    expect(g.current?.name).toBe('Game')
  })
  it('idle never blocks what runs without keyboard/mouse: a game started on a gamepad, a video, music', () => {
    expect(run(initialState(), game(), 0, 3, STALE_MS * 2).current?.name).toBe('Game')
    const vlc = sample({ pid: 30, key: 'vlc.exe', name: 'VLC', kind: 'video' })
    let v = run(initialState(), vlc, 0, 8, STALE_MS * 2)
    expect(v.current?.name).toBe('VLC')
    v = run(v, vlc, 9000, 5, STALE_MS * 3)
    expect(v.current?.name).toBe('VLC')
  })
  it('switching apps: new app replaces after its dwell; a non-game never replaces a live game; another game does', () => {
    let st = run(initialState(), sample(), 0, 8)
    st = run(st, sample({ pid: 11, key: 'blender.exe', name: 'Blender', kind: 'creative' }), 9000, 8)
    expect(st.current?.name).toBe('Blender')
    st = run(st, game(), 20_000, 3)
    expect(st.current?.name).toBe('Game')
    st = run(st, sample(), 30_000, 60)
    expect(st.current?.name).toBe('Game')
    st = run(st, game({ pid: 21, key: 'other.exe', name: 'Other', procStart: 7000 }), 100_000, 3)
    expect(st.current).toMatchObject({ name: 'Other', startedAt: 7000 })
  })
  it('a flicker shorter than the dwell never becomes current', () => {
    let st = run(initialState(), game(), 0, 2)
    st = run(st, null, 3000, 1)
    st = run(st, game(), 4000, 2)
    expect(st.current).toBeNull()
  })
})
