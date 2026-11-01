// Pure hotkey logic (no Electron, no native hook) so it can be unit-tested.
// Keycodes are uiohook-napi (libuiohook VC_*) scan-code based values; mouse buttons are 1..5 (4/5 = side).

export interface Chord {
  keys: number[]
  mouseButtons: number[]
}
export interface Phase<A extends string> {
  action: A
  phase: 'down' | 'up'
}

export const ESC = 1
const MODIFIER_ORDER = [29, 3613, 42, 54, 56, 3640, 3675, 3676] // Ctrl, Shift, Alt, Win (left before right)

const NUMPAD_NAV = 0xee00
// shortcut: punctuation names assume the pt-BR ABNT2 layout (scan code -> legend); upgrade to GetKeyNameTextW via a native module if layouts vary.
const KEY_NAMES: Record<number, string> = {
  1: 'Esc', 14: 'Backspace', 15: 'Tab', 28: 'Enter', 57: 'Espaço', 58: 'Caps Lock',
  3655: 'Home', 3663: 'End', 3657: 'Page Up', 3665: 'Page Down', 3666: 'Insert', 3667: 'Delete',
  57416: 'Seta ↑', 57424: 'Seta ↓', 57419: 'Seta ←', 57421: 'Seta →',
  29: 'Ctrl', 3613: 'Ctrl Dir.', 42: 'Shift', 54: 'Shift Dir.', 56: 'Alt', 3640: 'AltGr', 3675: 'Win', 3676: 'Win Dir.',
  69: 'Num Lock', 70: 'Scroll Lock', 3639: 'Print Screen', 3653: 'Pause',
  82: 'Num 0', 79: 'Num 1', 80: 'Num 2', 81: 'Num 3', 75: 'Num 4', 76: 'Num 5', 77: 'Num 6', 71: 'Num 7', 72: 'Num 8', 73: 'Num 9',
  55: 'Num *', 78: 'Num +', 74: 'Num -', 83: 'Num ,', 3637: 'Num /', 3612: 'Num Enter',
  [NUMPAD_NAV | 82]: 'Num Insert', [NUMPAD_NAV | 79]: 'Num End', [NUMPAD_NAV | 80]: 'Num ↓', [NUMPAD_NAV | 81]: 'Num Page Down',
  [NUMPAD_NAV | 75]: 'Num ←', [NUMPAD_NAV | 77]: 'Num →', [NUMPAD_NAV | 71]: 'Num Home', [NUMPAD_NAV | 72]: 'Num ↑',
  [NUMPAD_NAV | 73]: 'Num Page Up', [NUMPAD_NAV | 83]: 'Num Delete',
  41: "'", 12: '-', 13: '=', 26: '´', 27: '[', 39: 'Ç', 40: '~', 43: ']', 51: ',', 52: '.', 53: ';', 115: '/',
  // Letters and digits (identical on ABNT2 and US).
  ...Object.fromEntries([...'QWERTYUIOP'].map((c, i) => [16 + i, c])),
  ...Object.fromEntries([...'ASDFGHJKL'].map((c, i) => [30 + i, c])),
  ...Object.fromEntries([...'ZXCVBNM'].map((c, i) => [44 + i, c])),
  ...Object.fromEntries([...'1234567890'].map((c, i) => [2 + i, c])),
  // F1-F10 = 59..68, F11/F12 = 87/88, F13-F15 = 91..93, F16-F24 = 99..107.
  ...Object.fromEntries([59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107].map((code, i) => [code, `F${i + 1}`])),
}

export function keyName(code: number): string {
  return KEY_NAMES[code] ?? `Tecla ${code}`
}

/** Human label in pt-BR: modifiers first, then keys in press order, then mouse buttons. "Ctrl + M", "Mouse 4". */
export function chordLabel(chord: Chord): string {
  const mods = MODIFIER_ORDER.filter((m) => chord.keys.includes(m))
  const rest = chord.keys.filter((k) => !MODIFIER_ORDER.includes(k))
  const parts = [...mods, ...rest].map(keyName).concat([...chord.mouseButtons].sort((a, b) => a - b).map((b) => `Mouse ${b}`))
  return parts.length ? parts.join(' + ') : 'Nenhum'
}

/**
 * Tracks what is physically held and turns it into down/up phases per binding.
 * A binding is "down" while all its keys/buttons are held; extra held keys don't block it
 * (push-to-talk must work while the player holds W or Shift).
 */
export class ChordMatcher<A extends string> {
  private keys = new Set<number>()
  private buttons = new Set<number>()
  private active = new Set<number>()
  private bindings: Array<Chord & { action: A }> = []

  /** Replace bindings; anything that was down is released first. */
  setBindings(bindings: Array<Chord & { action: A }>): Phase<A>[] {
    const ups = this.releaseActive()
    this.bindings = bindings.filter((b) => b.keys.length + b.mouseButtons.length > 0)
    return ups
  }
  keyDown(code: number): Phase<A>[] {
    if (this.keys.has(code)) return [] // auto-repeat
    this.keys.add(code)
    return this.diff()
  }
  keyUp(code: number): Phase<A>[] {
    return this.keys.delete(code) ? this.diff() : []
  }
  mouseDown(button: number): Phase<A>[] {
    if (this.buttons.has(button)) return []
    this.buttons.add(button)
    return this.diff()
  }
  mouseUp(button: number): Phase<A>[] {
    return this.buttons.delete(button) ? this.diff() : []
  }
  /** Forget everything held (suspend, lock screen, hook restart): emits "up" for active bindings. */
  reset(): Phase<A>[] {
    this.keys.clear()
    this.buttons.clear()
    return this.diff()
  }
  private releaseActive(): Phase<A>[] {
    const ups = [...this.active].map((i) => ({ action: this.bindings[i]!.action, phase: 'up' as const }))
    this.active.clear()
    return ups
  }
  private diff(): Phase<A>[] {
    const out: Phase<A>[] = []
    this.bindings.forEach((b, i) => {
      const held = b.keys.every((k) => this.keys.has(k)) && b.mouseButtons.every((m) => this.buttons.has(m))
      if (held && !this.active.has(i)) {
        this.active.add(i)
        out.push({ action: b.action, phase: 'down' })
      } else if (!held && this.active.has(i)) {
        this.active.delete(i)
        out.push({ action: b.action, phase: 'up' })
      }
    })
    return out
  }
}

/**
 * Captures one combo: everything pressed until all of it is released. Esc cancels.
 * Left/right mouse buttons are ignored (they are how the user clicks "record").
 */
export class ChordRecorder {
  private keys: number[] = []
  private buttons: number[] = []
  private held = new Set<string>()

  /** Returns 'cancel' on Esc, a chord when the combo is complete, otherwise null. */
  keyDown(code: number): 'cancel' | null {
    if (code === ESC) return 'cancel'
    if (!this.keys.includes(code) && this.keys.length < 4) this.keys.push(code)
    this.held.add(`k${code}`)
    return null
  }
  keyUp(code: number): Chord | null {
    return this.release(`k${code}`)
  }
  mouseDown(button: number): null {
    if (button < 3 || button > 5) return null
    if (!this.buttons.includes(button)) this.buttons.push(button)
    this.held.add(`m${button}`)
    return null
  }
  mouseUp(button: number): Chord | null {
    return this.release(`m${button}`)
  }
  private release(id: string): Chord | null {
    if (!this.held.delete(id) || this.held.size > 0) return null
    return { keys: [...this.keys], mouseButtons: [...this.buttons] }
  }
}
