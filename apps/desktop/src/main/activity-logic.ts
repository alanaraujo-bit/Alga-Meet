import type { ActivityKind } from '@alga/shared'

// Pure logic of the "Atividade" feature (no electron): what an exe is, and when a foreground app becomes the activity.

export interface Classified {
  /** null = not recognized (browsers, messengers, anything unknown): listed, hidden until the person turns it on. */
  kind: ActivityKind | null
  name: string
  /** A guess (an unknown app in fullscreen may be a game, or a maximized remote desktop): listed, but opt-in. */
  guessed?: boolean
}

/** Shared unless the person says otherwise: recognized apps yes; unknown apps and guesses no. */
export const defaultShown = (c: Classified): boolean => c.kind !== null && !c.guessed

export interface ClassifyInput {
  path: string
  product: string
  desc: string
  fs: boolean
  /** Lowercased exe file name. */
  exeName: string
  /** Name from a Steam/Epic manifest for this install, when one exists. */
  manifestName?: string
}

export const exeNameOf = (path: string): string => path.slice(path.lastIndexOf('\\') + 1).toLowerCase()

/** Never listed: Windows shell/system, Alga Meet, launchers, crash handlers, anti-cheat, installers. */
const IGNORE_EXES = new Set([
  'explorer.exe', 'taskmgr.exe', 'searchhost.exe', 'searchapp.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
  'shellhost.exe', 'lockapp.exe', 'logonui.exe', 'applicationframehost.exe', 'textinputhost.exe', 'systemsettings.exe',
  'openwith.exe', 'dwm.exe', 'csrss.exe', 'winlogon.exe', 'consent.exe', 'werfault.exe', 'rundll32.exe', 'msiexec.exe',
  'snippingtool.exe', 'screenclippinghost.exe', 'sihost.exe', 'widgets.exe', 'credentialuibroker.exe',
  'alga meet.exe', 'electron.exe', 'alga-activity.exe',
  // launchers and stores
  'steam.exe', 'steamwebhelper.exe', 'steamservice.exe', 'epicgameslauncher.exe', 'epicwebhelper.exe', 'battle.net.exe',
  'battle.net launcher.exe', 'agent.exe', 'gogalaxy.exe', 'galaxyclient.exe', 'upc.exe', 'ubisoftconnect.exe',
  'ubisoftgamelauncher.exe', 'ubisoftgamelauncher64.exe', 'eadesktop.exe', 'eabackgroundservice.exe', 'origin.exe',
  'riotclientservices.exe', 'riotclientux.exe', 'riotclientuxrender.exe', 'riot client.exe', 'leagueclient.exe',
  'leagueclientux.exe', 'leagueclientuxrender.exe', 'minecraftlauncher.exe', 'playgtav.exe', 'rockstarservice.exe',
  'launcher.exe', 'bethesdanetlauncher.exe', 'xboxpcapp.exe', 'gamingservices.exe', 'xboxapp.exe',
  // crash handlers and anti-cheat
  'crashhandler.exe', 'crashhandler64.exe', 'unitycrashhandler32.exe', 'unitycrashhandler64.exe', 'crashreportclient.exe',
  'crashpad_handler.exe', 'bugsplatrc.exe', 'bugsplatrc64.exe', 'beservice.exe', 'beservice_x64.exe', 'battleye.exe',
  'vgc.exe', 'vgtray.exe', 'easyanticheat.exe', 'easyanticheat_eos.exe', 'easyanticheat_launcher.exe', 'faceitclient.exe',
  'faceit.exe', 'esea.exe', 'gameguard.des', 'xigncode.exe',
])
const IGNORE_RE = [/^unins\d*\.exe$/, /^(setup|install|installer|update|updater)[\w .-]*\.exe$/, /[-_ ](setup|installer)\.exe$/, /^easyanticheat/, /^vc_?redist/, /^dxsetup/, /crash(reporter|handler|report)/]
const IGNORE_PATH_RE = /\\windows\\(systemapps|immersivecontrolpanel)\\/i

/** Browsers and messengers: recognized as apps, but "unknown" for sharing (hidden by default). */
const UNKNOWN_KNOWN: Record<string, string> = {
  'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge', 'firefox.exe': 'Firefox', 'brave.exe': 'Brave',
  'opera.exe': 'Opera', 'opera_gx.exe': 'Opera GX', 'vivaldi.exe': 'Vivaldi', 'arc.exe': 'Arc', 'iexplore.exe': 'Internet Explorer',
  'whatsapp.exe': 'WhatsApp', 'whatsapp.root.exe': 'WhatsApp', 'telegram.exe': 'Telegram', 'discord.exe': 'Discord',
  'discordptb.exe': 'Discord', 'teams.exe': 'Microsoft Teams', 'ms-teams.exe': 'Microsoft Teams', 'slack.exe': 'Slack',
  'outlook.exe': 'Outlook', 'olk.exe': 'Outlook', 'zoom.exe': 'Zoom', 'signal.exe': 'Signal', 'thunderbird.exe': 'Thunderbird',
}

type Row = [kind: ActivityKind, name: string, ...exes: string[]]
const rows = (list: Row[]): Record<string, { kind: ActivityKind; name: string }> => {
  const out: Record<string, { kind: ActivityKind; name: string }> = {}
  for (const [kind, name, ...exes] of list) for (const e of exes) out[e] = { kind, name }
  return out
}

/** Known games: exe (lowercase) -> pretty name. Exported for tests. */
export const GAMES: Row[] = [
  ['game', 'VALORANT', 'valorant.exe', 'valorant-win64-shipping.exe'],
  ['game', 'League of Legends', 'leagueoflegends.exe', 'league of legends.exe'],
  ['game', 'Counter-Strike 2', 'cs2.exe'],
  ['game', 'Counter-Strike: Global Offensive', 'csgo.exe'],
  ['game', 'Fortnite', 'fortniteclient-win64-shipping.exe', 'fortniteclient-win64-shipping_be.exe'],
  ['game', 'Roblox', 'robloxplayerbeta.exe', 'robloxplayer.exe'],
  ['game', 'Minecraft', 'minecraft.windows.exe', 'minecraft.exe'],
  ['game', 'Grand Theft Auto V', 'gta5.exe', 'gta5_enhanced.exe'],
  ['game', 'Grand Theft Auto IV', 'gtaiv.exe'],
  ['game', 'Grand Theft Auto: San Andreas', 'gta_sa.exe', 'gta-sa.exe'],
  ['game', 'San Andreas Multiplayer', 'samp.exe'],
  ['game', 'FiveM', 'fivem.exe'],
  ['game', 'alt:V', 'altv.exe'],
  ['game', 'RAGE Multiplayer', 'ragemp_v.exe'],
  ['game', 'Red Dead Redemption 2', 'rdr2.exe'],
  ['game', 'Call of Duty: Black Ops II', 't6mp.exe', 't6zm.exe', 'plutonium-bootstrapper-win32.exe', 'plutonium.exe'],
  ['game', 'Call of Duty', 'cod.exe'],
  ['game', 'Call of Duty: Modern Warfare', 'modernwarfare.exe'],
  ['game', 'Apex Legends', 'r5apex.exe', 'r5apex_dx12.exe'],
  ['game', 'Rocket League', 'rocketleague.exe'],
  ['game', 'Dota 2', 'dota2.exe'],
  ['game', 'Overwatch 2', 'overwatch.exe'],
  ['game', 'Elden Ring', 'eldenring.exe'],
  ['game', 'Elden Ring Nightreign', 'nightreign.exe'],
  ['game', 'Cyberpunk 2077', 'cyberpunk2077.exe'],
  ['game', 'The Last of Us Part I', 'tlou-i.exe', 'tlou-i-l.exe'],
  ['game', 'The Last of Us Part II', 'tlou-ii.exe', 'tlou-ii-l.exe'],
  ['game', 'Once Human', 'oh-win64-shipping.exe'],
  ['game', 'Palworld', 'palworld-win64-shipping.exe'],
  ['game', 'Marvel Rivals', 'marvel-win64-shipping.exe'],
  ['game', 'EA SPORTS FC 24', 'fc24.exe'],
  ['game', 'EA SPORTS FC 25', 'fc25.exe'],
  ['game', 'EA SPORTS FC 26', 'fc26.exe'],
  ['game', 'FIFA 23', 'fifa23.exe'],
  ['game', 'eFootball', 'efootball.exe'],
  ['game', 'PUBG: BATTLEGROUNDS', 'tslgame.exe'],
  ['game', 'Rust', 'rustclient.exe'],
  ['game', 'Terraria', 'terraria.exe'],
  ['game', 'Stardew Valley', 'stardew valley.exe', 'stardewvalley.exe'],
  ['game', 'Among Us', 'among us.exe'],
  ['game', 'Genshin Impact', 'genshinimpact.exe', 'yuanshen.exe'],
  ['game', 'Honkai: Star Rail', 'starrail.exe'],
  ['game', 'Zenless Zone Zero', 'zenlesszonezero.exe'],
  ['game', 'Warframe', 'warframe.x64.exe', 'warframe.exe'],
  ['game', 'Deadlock', 'deadlock.exe'],
  ['game', 'HELLDIVERS 2', 'helldivers2.exe'],
  ['game', "Baldur's Gate 3", 'bg3.exe', 'bg3_dx11.exe'],
  ['game', 'Dead by Daylight', 'deadbydaylight-win64-shipping.exe'],
  ['game', "Tom Clancy's Rainbow Six Siege", 'rainbowsix.exe', 'rainbowsix_vulkan.exe', 'rainbowsix_be.exe'],
  ['game', 'Left 4 Dead 2', 'left4dead2.exe'],
  ['game', 'Team Fortress 2', 'tf_win64.exe', 'hl2.exe'],
  ['game', 'Battlefield 2042', 'bf2042.exe'],
  ['game', 'Battlefield V', 'bfv.exe'],
  ['game', 'Fallout 4', 'fallout4.exe'],
  ['game', 'The Elder Scrolls V: Skyrim', 'skyrimse.exe', 'skyrim.exe'],
  ['game', 'Starfield', 'starfield.exe'],
  ['game', "No Man's Sky", 'nms.exe'],
  ['game', 'The Witcher 3: Wild Hunt', 'witcher3.exe'],
  ['game', 'Resident Evil 4', 're4.exe'],
  ['game', 'Resident Evil Village', 're8.exe'],
  ['game', 'Sekiro: Shadows Die Twice', 'sekiro.exe'],
  ['game', 'Dark Souls III', 'darksoulsiii.exe'],
  ['game', 'Hogwarts Legacy', 'hogwartslegacy.exe'],
  ['game', 'Euro Truck Simulator 2', 'eurotrucks2.exe'],
  ['game', 'American Truck Simulator', 'amtrucks.exe'],
  ['game', 'Forza Horizon 5', 'forzahorizon5.exe'],
  ['game', 'Hollow Knight', 'hollow knight.exe'],
  ['game', 'Celeste', 'celeste.exe'],
  ['game', 'Fall Guys', 'fallguys_client_game.exe'],
  ['game', 'Destiny 2', 'destiny2.exe'],
  ['game', 'World of Warcraft', 'wow.exe', 'wowclassic.exe'],
  ['game', 'Diablo IV', 'diablo iv.exe'],
  ['game', 'Hearthstone', 'hearthstone.exe'],
  ['game', 'Final Fantasy XIV', 'ffxiv_dx11.exe'],
  ['game', 'Guild Wars 2', 'gw2-64.exe'],
  ['game', 'Valheim', 'valheim.exe'],
  ['game', 'Phasmophobia', 'phasmophobia.exe'],
  ['game', 'Lethal Company', 'lethal company.exe'],
  ['game', 'Project Zomboid', 'projectzomboid64.exe'],
  ['game', 'Street Fighter 6', 'sf6.exe'],
  ['game', 'Tibia', 'tibia.exe'],
  ['game', 'Geometry Dash', 'geometrydash.exe'],
  ['game', 'Cities: Skylines', 'cities.exe'],
  ['game', 'Arma 3', 'arma3_x64.exe'],
  ['game', 'DayZ', 'dayz_x64.exe'],
  ['game', 'THE FINALS', 'discovery.exe'],
]

const APPS: Row[] = [
  ['code', 'Visual Studio Code', 'code.exe'],
  ['code', 'Visual Studio Code Insiders', 'code - insiders.exe'],
  ['code', 'Visual Studio', 'devenv.exe'],
  ['code', 'IntelliJ IDEA', 'idea64.exe', 'idea.exe'],
  ['code', 'PyCharm', 'pycharm64.exe', 'pycharm.exe'],
  ['code', 'WebStorm', 'webstorm64.exe'],
  ['code', 'PhpStorm', 'phpstorm64.exe'],
  ['code', 'Rider', 'rider64.exe'],
  ['code', 'CLion', 'clion64.exe'],
  ['code', 'GoLand', 'goland64.exe'],
  ['code', 'DataGrip', 'datagrip64.exe'],
  ['code', 'RubyMine', 'rubymine64.exe'],
  ['code', 'Android Studio', 'studio64.exe'],
  ['code', 'Cursor', 'cursor.exe'],
  ['code', 'Windsurf', 'windsurf.exe'],
  ['code', 'Zed', 'zed.exe'],
  ['code', 'Sublime Text', 'sublime_text.exe'],
  ['code', 'Notepad++', 'notepad++.exe'],
  ['code', 'Unity Editor', 'unity.exe'],
  ['code', 'Unreal Editor', 'unrealeditor.exe', 'ue4editor.exe'],
  ['code', 'Godot Engine', 'godot.exe'],
  ['code', 'Roblox Studio', 'robloxstudiobeta.exe'],
  ['creative', 'Blender', 'blender.exe', 'blender-launcher.exe'],
  ['creative', 'Adobe Photoshop', 'photoshop.exe'],
  ['creative', 'Adobe Illustrator', 'illustrator.exe'],
  ['creative', 'Adobe After Effects', 'afterfx.exe'],
  ['creative', 'Adobe Premiere Pro', 'adobe premiere pro.exe'],
  ['creative', 'Adobe InDesign', 'indesign.exe'],
  ['creative', 'Adobe Lightroom', 'lightroom.exe'],
  ['creative', 'Figma', 'figma.exe'],
  ['creative', 'Cinema 4D', 'cinema 4d.exe'],
  ['creative', 'DaVinci Resolve', 'resolve.exe'],
  ['creative', 'OBS Studio', 'obs64.exe', 'obs32.exe'],
  ['creative', 'Krita', 'krita.exe'],
  ['creative', 'Audacity', 'audacity.exe'],
  ['creative', 'FL Studio', 'fl64.exe', 'fl.exe'],
  ['creative', 'Clip Studio Paint', 'clipstudiopaint.exe'],
  ['music', 'Spotify', 'spotify.exe'],
  ['music', 'Deezer', 'deezer.exe'],
  ['music', 'TIDAL', 'tidal.exe'],
  ['video', 'VLC', 'vlc.exe'],
  ['video', 'mpv', 'mpv.exe'],
  ['video', 'PotPlayer', 'potplayermini64.exe', 'potplayermini.exe'],
  ['video', 'MPC-HC', 'mpc-hc64.exe', 'mpc-hc.exe'],
]

const KNOWN = { ...rows(GAMES), ...rows(APPS) }

/** Install folders that mean "a game lives here": the capture group is the game's folder name. */
const GAME_DIRS = [
  /\\steamapps\\common\\([^\\]+)/i,
  /\\epic games\\([^\\]+)/i,
  /\\riot games\\([^\\]+)/i,
  /\\xboxgames\\([^\\]+)/i,
  /\\gog games\\([^\\]+)/i,
  /\\gog galaxy\\games\\([^\\]+)/i,
  /\\ubisoft game launcher\\games\\([^\\]+)/i,
  /\\ea games\\([^\\]+)/i,
  /\\rockstar games\\([^\\]+)/i,
]
const MINECRAFT_PATH = /minecraft|tlauncher|prismlauncher|curseforge/i
const GENERIC_NAME = /^(unity|unrealengine|unreal engine|java|openjdk.*|.*platform se binary|electron|chromium|microsoft.*windows.*|game|launcher|shipping|.*-win64-shipping)$/i

const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
const usable = (s: string | undefined): string => {
  const c = clean(s ?? '')
  return c && !GENERIC_NAME.test(c) ? c.slice(0, 64) : ''
}
const stem = (exe: string) => exe.replace(/\.exe$/, '')

function folderOf(path: string): string {
  for (const re of GAME_DIRS) {
    const m = re.exec(path)
    if (m) return m[1] ?? ''
  }
  return ''
}

export function classify(i: ClassifyInput): Classified | 'ignore' {
  const exe = i.exeName
  if (IGNORE_EXES.has(exe) || IGNORE_RE.some((r) => r.test(exe)) || IGNORE_PATH_RE.test(i.path)) return 'ignore'
  const known = KNOWN[exe]
  if (known) return known
  if (exe.startsWith('fivem')) return { kind: 'game', name: 'FiveM' }
  if (exe.startsWith('gimp')) return { kind: 'creative', name: 'GIMP' }
  if ((exe === 'javaw.exe' || exe === 'java.exe') && MINECRAFT_PATH.test(i.path)) return { kind: 'game', name: 'Minecraft' }
  const unknownKnown = UNKNOWN_KNOWN[exe]
  if (unknownKnown) return { kind: null, name: unknownKnown }
  const dir = folderOf(i.path)
  const name = usable(i.manifestName) || usable(i.product) || usable(i.desc) || usable(dir) || clean(stem(exe)).slice(0, 64) || 'App'
  if (dir) return { kind: 'game', name }
  return i.fs ? { kind: 'game', name, guessed: true } : { kind: null, name }
}

// ---- state machine ----

export const DWELL_GAME_MS = 3_000
export const DWELL_APP_MS = 8_000
/** A non-game activity ends after this long without being in the foreground, or with the system idle this long. */
export const STALE_MS = 15 * 60_000

/** The foreground app, already classified and checked against the person's per-app choice. */
export interface Sample {
  pid: number
  key: string
  name: string
  kind: ActivityKind | null
  ignored: boolean
  shown: boolean
  /** Process start (epoch ms), 0 when unknown. */
  procStart: number
  steamAppId?: number
}

export interface Current {
  key: string
  pid: number
  name: string
  /** Effective kind: unrecognized apps the person turned on are 'app'. */
  kind: ActivityKind
  startedAt: number
  steamAppId?: number
  lastFocus: number
}

export interface State {
  current: Current | null
  cand: { key: string; pid: number; since: number } | null
  firstSeen: Record<number, number>
}

/** Kinds that legitimately run with no keyboard/mouse input. */
const passive = (k: ActivityKind | null): boolean => k === 'game' || k === 'video' || k === 'music'

export const initialState = (): State => ({ current: null, cand: null, firstSeen: {} })

/**
 * Advance one tick (1/s). `sample` is the foreground app or null (none). Ignored/hidden apps in the foreground
 * never end the current activity (alt-tab to a browser keeps "Playing X"); a live game outranks non-game apps.
 */
export function step(prev: State, sample: Sample | null, now: number, alive: (pid: number) => boolean, idleMs: number): State {
  const s: State = { current: prev.current, cand: prev.cand, firstSeen: { ...prev.firstSeen } }
  const idle = idleMs >= STALE_MS

  const cur = s.current
  if (cur) {
    if (cur.kind === 'game') {
      if (!alive(cur.pid)) s.current = null
    } else if ((idle && !passive(cur.kind)) || now - cur.lastFocus >= STALE_MS) s.current = null
  }

  const eligible = !!sample && sample.pid > 0 && !sample.ignored && sample.shown
  // Idle (no keyboard/mouse) means away for work apps, not for games (gamepads do not count as input on Windows)
  // nor for a video or music playing on its own.
  if (!eligible || !sample || (idle && !passive(sample.kind))) {
    s.cand = null
    return s
  }
  if (!(sample.pid in s.firstSeen)) {
    s.firstSeen[sample.pid] = now
    const pids = Object.keys(s.firstSeen)
    if (pids.length > 64) for (const p of pids) if (!alive(Number(p))) delete s.firstSeen[Number(p)]
  }

  const now0 = s.current
  if (now0 && now0.key === sample.key && now0.pid === sample.pid) {
    s.current = { ...now0, lastFocus: now }
    s.cand = null
    return s
  }
  const isGame = sample.kind === 'game'
  if (now0 && now0.kind === 'game' && !isGame) {
    s.cand = null // a live game is not replaced by a non-game app
    return s
  }
  if (!s.cand || s.cand.key !== sample.key || s.cand.pid !== sample.pid) s.cand = { key: sample.key, pid: sample.pid, since: now }
  if (now - s.cand.since >= (isGame ? DWELL_GAME_MS : DWELL_APP_MS)) {
    s.current = {
      key: sample.key,
      pid: sample.pid,
      name: sample.name,
      kind: sample.kind ?? 'app',
      startedAt: isGame ? (sample.procStart > 0 ? sample.procStart : (s.firstSeen[sample.pid] ?? now)) : s.cand.since,
      steamAppId: sample.steamAppId,
      lastFocus: now,
    }
    s.cand = null
  }
  return s
}
