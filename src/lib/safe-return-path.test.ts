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

  it('preserves a same-origin path, query, and fragment', () => {
    expect(resolveSafeReturnPath('/admin/sites?tab=active#site-1', '/admin')).toBe(
      '/admin/sites?tab=active#site-1',
    )
  })
})
