/** Security regressions for post-authentication return destinations. */

import { describe, expect, it } from 'vitest'
import { resolveSafeReturnPath } from './safe-return-path'

describe('resolveSafeReturnPath', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', ''])(
    'rejects unsafe destination %j',
    (value) => {
      expect(resolveSafeReturnPath(value, '/admin')).toBe('/admin')
    },
  )

  it.each(['/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/%2e//evil.example', '/./\\evil.example'])(
    'rejects %j, which normalizes to a scheme-relative URL',
    (value) => {
      const resolved = resolveSafeReturnPath(value, '/')
      expect(resolved).toBe('/')
      expect(new URL(resolved, 'https://docs.example.com').origin).toBe('https://docs.example.com')
    },
  )

  it('is idempotent', () => {
    for (const value of ['/a/./b/../c?x=1#y', '/guides/beta', '/%2F%2Fevil.example']) {
      const once = resolveSafeReturnPath(value, '/')
      expect(resolveSafeReturnPath(once, '/')).toBe(once)
      expect(new URL(once, 'https://docs.example.com').origin).toBe('https://docs.example.com')
    }
  })

  it('preserves a same-origin path, query, and fragment', () => {
    expect(resolveSafeReturnPath('/admin/sites?tab=active#site-1', '/admin')).toBe(
      '/admin/sites?tab=active#site-1',
    )
  })
})
