/** State-level regression coverage for the page-feedback follow-up prompt. */

import { describe, expect, it } from 'vitest'

import { shouldShowFeedbackMessage } from './feedback'

describe('page feedback message visibility', () => {
  it('never asks for a note after a positive rating', () => {
    expect(shouldShowFeedbackMessage('yes', true, 'idle')).toBe(false)
  })

  it('asks for an optional note after a negative rating when enabled', () => {
    expect(shouldShowFeedbackMessage('no', true, 'idle')).toBe(true)
  })

  it('hides the prompt when written feedback is disabled or already sent', () => {
    expect(shouldShowFeedbackMessage('no', false, 'idle')).toBe(false)
    expect(shouldShowFeedbackMessage('no', true, 'sent')).toBe(false)
  })
})
