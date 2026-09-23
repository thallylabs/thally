/** Security regressions for domain-separated administrative session tokens. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAdminSessionToken,
  createDocsAccessToken,
  verifyAdminSessionToken,
  verifyDocsAccessToken,
} from './auth'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('session token scopes', () => {
  it('never accepts a docs-access token as an admin session', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ADMIN_PASSWORD', 'admin-password')
    vi.stubEnv('THALLY_ADMIN_SECRET', 'admin-signing-secret')
    vi.stubEnv('THALLY_ACCESS_PASSWORD', 'docs-password')
    vi.stubEnv('THALLY_ACCESS_SECRET', 'docs-signing-secret')

    const docsToken = createDocsAccessToken()

    expect(docsToken).not.toBeNull()
    expect(verifyDocsAccessToken(docsToken ?? undefined)).toBe(true)
    expect(verifyAdminSessionToken(docsToken ?? undefined)).toBe(false)
  })

  it('never accepts an admin token as a docs-access token', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ADMIN_PASSWORD', 'admin-password')
    vi.stubEnv('THALLY_ADMIN_SECRET', 'admin-signing-secret')
    vi.stubEnv('THALLY_ACCESS_PASSWORD', 'docs-password')
    vi.stubEnv('THALLY_ACCESS_SECRET', 'docs-signing-secret')

    const adminToken = createAdminSessionToken()

    expect(adminToken).not.toBeNull()
    expect(verifyAdminSessionToken(adminToken ?? undefined)).toBe(true)
    expect(verifyDocsAccessToken(adminToken ?? undefined)).toBe(false)
  })
})
