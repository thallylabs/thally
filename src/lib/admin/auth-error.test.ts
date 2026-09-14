/** Authentication forms must distinguish actionable status classes safely. */

import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage } from '@/lib/admin/auth-error'

describe('getAuthErrorMessage', () => {
  it('maps 401, 429, and 5xx to distinct messages', () => {
    const unauthorized = getAuthErrorMessage('admin', 401)
    const limited = getAuthErrorMessage('admin', 429)
    const unavailable = getAuthErrorMessage('admin', 503)

    expect(new Set([unauthorized, limited, unavailable]).size).toBe(3)
    expect(unauthorized).toContain('password')
    expect(limited).toContain('Too many')
    expect(unavailable).toContain('temporarily unavailable')
  })

  it('uses surface-specific 401 copy without exposing server details', () => {
    expect(getAuthErrorMessage('docs', 401)).toContain('documentation password')
    expect(getAuthErrorMessage('docs', 500)).not.toContain('database')
  })
})
