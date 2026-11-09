import { describe, expect, it } from 'vitest'
import { FEEDBACK_KINDS, FeedbackContext, FeedbackFields, kindTakesLog } from './feedback.js'

const ctx = { view: 'space', inCall: true, sharing: false, cinema: false, crash: null }

describe('feedback contract', () => {
  it('accepts a minimal send and trims the text', () => {
    expect(FeedbackFields.parse({ kind: 'idea', text: '  fixar mensagens  ', context: ctx }).text).toBe('fixar mensagens')
  })

  it('rejects empty, whitespace-only and over-long text', () => {
    for (const text of ['', '   ', 'a'.repeat(2001)]) expect(FeedbackFields.safeParse({ kind: 'bug', text, context: ctx }).success).toBe(false)
  })

  it('rejects a context with anything extra (no ids, no names)', () => {
    expect(FeedbackContext.safeParse({ ...ctx, spaceId: 'x' }).success).toBe(false)
  })

  it('rejects an unknown kind and an oversized log', () => {
    expect(FeedbackFields.safeParse({ kind: 'rant', text: 'a', context: ctx }).success).toBe(false)
    expect(FeedbackFields.safeParse({ kind: 'bug', text: 'a', context: ctx, log: 'x'.repeat(48 * 1024 + 1) }).success).toBe(false)
  })

  it('only bug and crash take the log', () => {
    expect(FEEDBACK_KINDS.filter(kindTakesLog)).toEqual(['bug', 'crash'])
  })
})
