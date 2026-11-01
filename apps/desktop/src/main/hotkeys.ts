import type { UiohookKeyboardEvent, UiohookMouseEvent } from 'uiohook-napi'
import type { HotkeyAction, HotkeyBinding } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { ChordMatcher, ChordRecorder, chordLabel, type Chord, type Phase } from './hotkey-logic'
import { arr, emit, handle, int, obj, str } from './ipc'
import { log } from './log'

// Global hotkeys via a low-level hook (uiohook-napi): sees key down AND up while a game has focus,
// which Electron's globalShortcut cannot. The hook only runs while there are bindings or a recording.
const ACTIONS: readonly HotkeyAction[] = ['pushToTalk', 'toggleMute', 'toggleDeafen', 'pushToMute']
const RECORD_TIMEOUT_MS = 30_000

type Hook = typeof import('uiohook-napi')
let hook: Hook | null = null
let hookFailed = false
let running = false
let bindings: HotkeyBinding[] = []
const matcher = new ChordMatcher<HotkeyAction>()
let recording: { recorder: ChordRecorder; done: (c: Chord | null) => void } | null = null

const dispatch = (phases: Phase<HotkeyAction>[]) => phases.forEach((p) => emit(IPC.hotkeysEvent, p))
const button = (e: UiohookMouseEvent) => (typeof e.button === 'number' ? e.button : 0)

function onKeyDown(e: UiohookKeyboardEvent): void {
  if (!recording) return dispatch(matcher.keyDown(e.keycode))
  if (recording.recorder.keyDown(e.keycode) === 'cancel') recording.done(null)
}
function onKeyUp(e: UiohookKeyboardEvent): void {
  if (!recording) return dispatch(matcher.keyUp(e.keycode))
  const chord = recording.recorder.keyUp(e.keycode)
  if (chord) recording.done(chord)
}
function onMouseDown(e: UiohookMouseEvent): void {
  if (!recording) return dispatch(matcher.mouseDown(button(e)))
  recording.recorder.mouseDown(button(e))
}
function onMouseUp(e: UiohookMouseEvent): void {
  if (!recording) return dispatch(matcher.mouseUp(button(e)))
  const chord = recording.recorder.mouseUp(button(e))
  if (chord) recording.done(chord)
}

function loadHook(): Hook | null {
  if (hook || hookFailed) return hook
  try {
    hook = require('uiohook-napi') as Hook
    const { uIOhook } = hook
    uIOhook.on('keydown', onKeyDown)
    uIOhook.on('keyup', onKeyUp)
    uIOhook.on('mousedown', onMouseDown)
    uIOhook.on('mouseup', onMouseUp)
  } catch (err) {
    hookFailed = true
    log.error('global hotkeys unavailable: uiohook-napi failed to load', err)
  }
  return hook
}

/** Start the hook only when something needs it; stop it otherwise. */
function syncHook(): void {
  const want = bindings.length > 0 || recording !== null
  if (want === running) return
  const h = loadHook()
  if (!h) return
  try {
    if (want) h.uIOhook.start()
    else h.uIOhook.stop()
    running = want
    dispatch(matcher.reset()) // a fresh hook knows nothing about keys held before it started
    log.info(`hotkey hook ${want ? 'started' : 'stopped'}`)
  } catch (err) {
    log.error('hotkey hook start/stop failed', err)
  }
}

/** Release everything held (suspend, lock screen): no stuck push-to-talk after events the hook never saw. */
export function releaseAllHotkeys(): void {
  dispatch(matcher.reset())
}

export function stopHotkeys(): void {
  bindings = [] // so the deferred syncHook from done() can't restart the hook while quitting
  recording?.done(null)
  if (running && hook) hook.uIOhook.stop()
  running = false
}

function parseChord(raw: unknown, allowEmpty = false): Chord {
  const o = obj(raw)
  const keys = arr(o.keys, 4).map((k) => int(k, 1, 0xffff))
  const mouseButtons = arr(o.mouseButtons, 2).map((b) => int(b, 1, 5))
  if (!allowEmpty && keys.length + mouseButtons.length === 0) throw new TypeError('empty hotkey')
  return { keys, mouseButtons }
}

function parseBindings(raw: unknown): HotkeyBinding[] {
  return arr(raw, 16).map((b) => {
    const action = str(obj(b).action, 32) as HotkeyAction
    if (!ACTIONS.includes(action)) throw new TypeError(`unknown hotkey action ${action}`)
    return { action, ...parseChord(b) }
  })
}

function record(): Promise<{ keys: number[]; mouseButtons: number[]; label: string } | null> {
  recording?.done(null) // a new record() supersedes a pending one
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), RECORD_TIMEOUT_MS)
    const finish = (c: Chord | null) => {
      if (recording?.done !== finish) return
      clearTimeout(timer)
      recording = null
      setTimeout(syncHook, 0) // never stop the hook from inside its own event callback (native error)
      resolve(c && { ...c, label: chordLabel(c) })
    }
    recording = { recorder: new ChordRecorder(), done: finish }
    syncHook()
    if (!running) finish(null) // hook unavailable
  })
}

export function registerHotkeyIpc(): void {
  handle(IPC.hotkeysSet, (raw) => {
    const next = parseBindings(raw)
    dispatch(matcher.setBindings(next))
    bindings = next
    syncHook()
  })
  handle(IPC.hotkeysRecord, () => record())
  handle(IPC.hotkeysLabel, (raw) => chordLabel(parseChord(raw, true)))
}
