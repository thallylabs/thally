import { describe, expect, it } from 'vitest'
import { resolvePlaygroundDisplay } from '@/lib/openapi/playground-display'

describe('resolvePlaygroundDisplay', () => {
  it('defaults to interactive, lets the page override the site, and fails closed on auth', () => {
    expect(resolvePlaygroundDisplay(undefined, undefined)).toBe('interactive')
    expect(resolvePlaygroundDisplay(undefined, 'none')).toBe('none')
    expect(resolvePlaygroundDisplay('interactive', 'none')).toBe('interactive')
    expect(resolvePlaygroundDisplay('auth', 'interactive')).toBe('simple')
    expect(resolvePlaygroundDisplay('bogus', 'simple')).toBe('simple')
  })
})
