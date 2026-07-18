import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_MODEL, resolveAgentModel } from '../model.js'

describe('resolveAgentModel', () => {
  it('uses the safe default when optional configuration is empty', () => {
    expect(resolveAgentModel(undefined, '', '   ')).toBe(DEFAULT_AGENT_MODEL)
  })

  it('trims values and preserves explicit/current/legacy precedence', () => {
    expect(resolveAgentModel(' explicit ', 'current', 'legacy')).toBe('explicit')
    expect(resolveAgentModel(undefined, ' current ', 'legacy')).toBe('current')
    expect(resolveAgentModel(undefined, ' ', ' legacy ')).toBe('legacy')
  })
})
