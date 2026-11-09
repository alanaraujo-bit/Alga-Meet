import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { AlgaBridge, AppConfig, DetectedApp, HotkeyBinding, LocalActivity, Unsubscribe } from '../shared/bridge'
import { IPC } from '../shared/ipc'

// Every argument is rebuilt as plain data here (no prototypes, functions or DOM objects cross);
// main validates each payload again and checks the sender frame.

const config = ipcRenderer.sendSync(IPC.config) as AppConfig

function subscribe<T>(channel: string, cb: (value: T) => void): Unsubscribe {
  if (typeof cb !== 'function') throw new TypeError('callback must be a function')
  const listener = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : [])
const chord = (b: Pick<HotkeyBinding, 'keys' | 'mouseButtons'>) => ({ keys: nums(b?.keys), mouseButtons: nums(b?.mouseButtons) })

/** Rebuild an activity from main as plain data (only the known fields cross). */
const plainActivity = (a: LocalActivity | null): LocalActivity | null =>
  a && {
    kind: a.kind,
    name: String(a.name),
    startedAt: Number(a.startedAt),
    key: String(a.key),
    ...(typeof a.icon === 'string' && { icon: a.icon }),
    ...(typeof a.steamAppId === 'number' && { steamAppId: a.steamAppId }),
  }
const plainApps = (l: DetectedApp[]): DetectedApp[] =>
  (Array.isArray(l) ? l : []).map((a) => ({ key: String(a.key), name: String(a.name), kind: a.kind, lastSeen: Number(a.lastSeen), shown: a.shown === true, ...(typeof a.icon === 'string' && { icon: a.icon }) }))

const bridge: AlgaBridge = {
  config,

  auth: {
    getToken: () => ipcRenderer.invoke(IPC.authGetToken),
    setToken: (token) => ipcRenderer.invoke(IPC.authSetToken, token === null ? null : String(token)),
  },

  window: {
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winToggleMaximize),
    close: () => ipcRenderer.send(IPC.winClose),
    isMaximized: () => ipcRenderer.invoke(IPC.winIsMaximized),
    onMaximizedChange: (cb) => subscribe(IPC.winMaximizedChanged, cb),
    onFocusChange: (cb) => subscribe(IPC.winFocusChanged, cb),
    setBadge: (count) => ipcRenderer.send(IPC.winSetBadge, Math.min(1_000_000, Math.max(0, Math.floor(Number(count) || 0)))),
    flashFrame: () => ipcRenderer.send(IPC.winFlashFrame),
    zoom: {
      get: () => ipcRenderer.invoke(IPC.winGetZoom),
      set: (factor) => ipcRenderer.invoke(IPC.winSetZoom, Number(factor)),
    },
  },

  screen: {
    getSources: (types) => ipcRenderer.invoke(IPC.screenGetSources, Array.isArray(types) ? types.map(String) : []),
    select: (sourceId, opts) => ipcRenderer.invoke(IPC.screenSelect, String(sourceId), { audio: opts?.audio === true }),
  },

  hotkeys: {
    set: (bindings) =>
      ipcRenderer.invoke(
        IPC.hotkeysSet,
        (Array.isArray(bindings) ? bindings : []).map((b) => ({ action: String(b?.action), ...chord(b) })),
      ),
    record: () => ipcRenderer.invoke(IPC.hotkeysRecord),
    onEvent: (cb) => subscribe(IPC.hotkeysEvent, cb),
    label: (binding) => ipcRenderer.invoke(IPC.hotkeysLabel, chord(binding)),
  },

  notify: (opts) =>
    ipcRenderer.send(IPC.notify, {
      title: String(opts?.title ?? ''),
      body: String(opts?.body ?? ''),
      ...(opts?.tag === undefined ? {} : { tag: String(opts.tag) }),
      silent: opts?.silent === true,
    }),
  onNotificationClick: (cb) => subscribe(IPC.notificationClick, cb),

  tray: {
    setVoiceState: (s) =>
      ipcRenderer.send(IPC.traySetVoiceState, {
        connected: s?.connected === true,
        muted: s?.muted === true,
        deafened: s?.deafened === true,
        ...(s?.channelName === undefined ? {} : { channelName: String(s.channelName) }),
      }),
    onAction: (cb) => subscribe(IPC.trayAction, cb),
  },

  power: {
    onSuspend: (cb) => subscribe(IPC.powerSuspend, () => cb()),
    onResume: (cb) => subscribe(IPC.powerResume, () => cb()),
  },

  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    status: () => ipcRenderer.invoke(IPC.updatesGet),
    onStatus: (cb) => subscribe(IPC.updatesStatus, cb),
    install: () => ipcRenderer.send(IPC.updatesInstall),
  },

  deepLinks: {
    onLink: (cb) => subscribe(IPC.deepLink, cb),
    takePending: () => ipcRenderer.invoke(IPC.deepLinksTakePending),
  },

  e2ee: {
    status: () => ipcRenderer.invoke(IPC.e2eeStatus),
    joinCall: (channelId) => ipcRenderer.invoke(IPC.e2eeJoin, String(channelId)),
    leaveCall: (channelId) => ipcRenderer.invoke(IPC.e2eeLeave, String(channelId)),
    // Gateway JSON: a JSON round trip keeps it plain data.
    handleDispatch: (t, d) => ipcRenderer.send(IPC.e2eeDispatch, String(t), JSON.parse(JSON.stringify(d ?? null))),
    onGatewaySend: (cb) => subscribe(IPC.e2eeSend, cb),
    onFrameKey: (cb) => subscribe(IPC.e2eeKey, cb),
    onEpoch: (cb) => subscribe(IPC.e2eeEpoch, cb),
    verificationCode: (channelId, userId) => ipcRenderer.invoke(IPC.e2eeCode, String(channelId), userId === undefined ? null : String(userId)),
    cinemaTag: (channelId, epoch, message) => ipcRenderer.invoke(IPC.e2eeCinemaTag, String(channelId), Number(epoch), String(message)),
  },

  cinema: {
    checkFfmpeg: () => ipcRenderer.invoke(IPC.cinemaCheckFfmpeg),
    pick: () => ipcRenderer.invoke(IPC.cinemaPick),
    // Only the path string crosses; main checks it again.
    fromDrop: (file) => ipcRenderer.invoke(IPC.cinemaFromDrop, webUtils.getPathForFile(file)),
    probe: (fileId) => ipcRenderer.invoke(IPC.cinemaProbe, String(fileId)),
    start: (fileId, startS, audioIds) => ipcRenderer.invoke(IPC.cinemaStart, String(fileId), Number(startS), nums(audioIds)),
    ensure: (fileId, track, atS) => ipcRenderer.send(IPC.cinemaEnsure, String(fileId), String(track), Number(atS)),
    addAudio: (fileId, audioId) => ipcRenderer.send(IPC.cinemaAddAudio, String(fileId), Number(audioId)),
    addSubtitle: (fileId) => ipcRenderer.invoke(IPC.cinemaAddSubtitle, String(fileId)),
    setPlayhead: (fileId, s) => ipcRenderer.send(IPC.cinemaSetPlayhead, String(fileId), Number(s)),
    init: (fileId, track) => ipcRenderer.invoke(IPC.cinemaInit, String(fileId), String(track)),
    piece: (fileId, track, n) => ipcRenderer.invoke(IPC.cinemaPiece, String(fileId), String(track), Number(n)),
    onPieces: (cb) => subscribe(IPC.cinemaPieces, cb),
    onEvicted: (cb) => subscribe(IPC.cinemaEvicted, cb),
    onError: (cb) => subscribe(IPC.cinemaError, cb),
    close: (fileId) => ipcRenderer.invoke(IPC.cinemaClose, String(fileId)),
    resumeAt: (fileId) => ipcRenderer.invoke(IPC.cinemaResumeAt, String(fileId)),
    saveResume: (fileId, positionS) => ipcRenderer.send(IPC.cinemaSaveResume, String(fileId), Number(positionS)),
    captureCard: (rect, action) => ipcRenderer.invoke(IPC.cinemaCaptureCard, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, String(action)),
  },

  activity: {
    current: async () => plainActivity(await ipcRenderer.invoke(IPC.activityCurrent)),
    onChange: (cb) => subscribe<LocalActivity | null>(IPC.activityChanged, (a) => cb(plainActivity(a))),
    getShare: () => ipcRenderer.invoke(IPC.activityGetShare),
    setShare: (on) => ipcRenderer.invoke(IPC.activitySetShare, on === true),
    apps: async () => plainApps(await ipcRenderer.invoke(IPC.activityApps)),
    setAppShown: (key, shown) => ipcRenderer.invoke(IPC.activitySetAppShown, String(key), shown === true),
  },

  app: {
    getStartAtLogin: () => ipcRenderer.invoke(IPC.appGetStartAtLogin),
    setStartAtLogin: (enabled) => ipcRenderer.invoke(IPC.appSetStartAtLogin, enabled === true),
    getCloseToTray: () => ipcRenderer.invoke(IPC.appGetCloseToTray),
    setCloseToTray: (enabled) => ipcRenderer.invoke(IPC.appSetCloseToTray, enabled === true),
    getTrayAnimation: () => ipcRenderer.invoke(IPC.appGetTrayAnimation),
    setTrayAnimation: (enabled) => ipcRenderer.invoke(IPC.appSetTrayAnimation, enabled === true),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, String(url)),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
    takeSetupEco: () => ipcRenderer.invoke(IPC.appTakeSetupEco),
    quit: () => ipcRenderer.send(IPC.appQuit),
  },
}

contextBridge.exposeInMainWorld('alga', bridge)
