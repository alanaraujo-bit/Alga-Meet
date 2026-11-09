import { FEEDBACK_KINDS, FeedbackContext } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { EMPTY_DRAFT, KIND_ECO, KIND_TONE, canSend, contextOf, draftKey, firstName, readDraft, sendsLog, shouldOfferCrash } from './logic'

describe('draft', () => {
  it('reads a draft and falls back on anything malformed', () => {
    expect(readDraft(JSON.stringify({ kind: 'bug', text: 'oi' }))).toEqual({ kind: 'bug', text: 'oi' })
    for (const raw of [null, '{', '[]', 'null', JSON.stringify({ kind: 'rant', text: 'x' }), JSON.stringify({ kind: 'bug', text: 7 }), JSON.stringify({ kind: 'bug', text: 'a'.repeat(2001) })]) {
      expect(readDraft(raw)).toEqual(EMPTY_DRAFT)
    }
  })

  it('starts on "idea" with nothing written', () => {
    expect(EMPTY_DRAFT).toEqual({ kind: 'idea', text: '' })
  })

  it('keeps drafts apart per account', () => {
    expect(draftKey('a')).not.toBe(draftKey('b'))
  })
})

describe('what goes along', () => {
  it('sends the log only for bug and crash, and only when left on', () => {
    expect([sendsLog('bug', true), sendsLog('crash', true), sendsLog('idea', true), sendsLog('praise', true), sendsLog('bug', false)]).toEqual([true, true, false, false, false])
  })

  it('builds a context the server accepts, with nothing but the closed fields', () => {
    const c = contextOf({ view: 'space', inCall: true, sharing: false, cinema: false, crash: { kind: 'renderer', at: 1, version: '0.1.15' } })
    expect(FeedbackContext.parse(c)).toEqual({ view: 'space', inCall: true, sharing: false, cinema: false, crash: 'renderer' })
    expect(contextOf({ view: 'home', inCall: false, sharing: false, cinema: false, crash: null }).crash).toBeNull()
  })

  it('validates the text like the server', () => {
    expect([canSend(''), canSend('  '), canSend('a'), canSend('a'.repeat(2000)), canSend('a'.repeat(2001))]).toEqual([false, false, true, true, false])
  })
})

describe('the offer after a crash', () => {
  const quiet = { inCall: false, gaming: false, overlay: false, attentive: true }
  const crash = { kind: 'unresponsive', at: 1, version: '0.1.15' } as const

  it('comes only in a quiet moment and never with the welcome', () => {
    expect(shouldOfferCrash(crash, quiet, false)).toBe(true)
    expect(shouldOfferCrash(crash, { ...quiet, inCall: true }, false)).toBe(false)
    expect(shouldOfferCrash(crash, { ...quiet, gaming: true }, false)).toBe(false)
    expect(shouldOfferCrash(crash, { ...quiet, overlay: true }, false)).toBe(false)
    expect(shouldOfferCrash(crash, { ...quiet, attentive: false }, false)).toBe(false)
    expect(shouldOfferCrash(crash, quiet, true)).toBe(false)
    expect(shouldOfferCrash(null, quiet, false)).toBe(false)
  })
})

describe('look per kind', () => {
  it('every kind has a tone and an Eco reaction', () => {
    for (const k of FEEDBACK_KINDS) {
      expect(KIND_TONE[k]).toMatch(/^#[0-9a-f]{6}$/)
      expect(KIND_ECO[k]).toBeTruthy()
    }
    expect(KIND_TONE).toEqual({ bug: '#e66e68', crash: '#e6b463', idea: '#8b8ef7', praise: '#61c28e' })
  })

  it('greets by the first name', () => {
    expect([firstName('Ana Novidades'), firstName('  Caio  '), firstName('')]).toEqual(['Ana', 'Caio', ''])
  })
})
