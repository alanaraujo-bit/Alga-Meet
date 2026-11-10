import { describe, expect, it } from 'vitest'
import { portalTarget } from './portal'

const el = (tagName: string) => ({ tagName }) as unknown as Element
const body = el('BODY') as HTMLElement

describe('where floating UI (menus, tooltips, toasts, dialogs) is mounted', () => {
  it('the body, normally', () => {
    expect(portalTarget({ fullscreenElement: null, body })).toBe(body)
  })

  it('inside the element in fullscreen: anything outside it is not drawn (the cinema room)', () => {
    const room = el('DIV')
    expect(portalTarget({ fullscreenElement: room, body })).toBe(room)
  })

  it('the body when the fullscreen element cannot hold children (a <video> or a canvas)', () => {
    for (const tag of ['VIDEO', 'CANVAS', 'IMG', 'IFRAME']) expect(portalTarget({ fullscreenElement: el(tag), body })).toBe(body)
  })
})
