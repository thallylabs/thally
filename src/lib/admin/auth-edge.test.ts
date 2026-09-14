/** Security regressions for edge-safe administrative and docs-session signing. */

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getInternalAnalyticsSecretEdge,
  getAdminSigningSecret,
  getDocsSigningSecret,
  isAdminAuthenticatedEdge,
  isDocsAccessGrantedEdge,
} from './auth-edge'

const SECRET_ENV_KEYS = [
  'THALLY_ADMIN_SECRET',
  'DOX_ADMIN_SECRET',
  'THALLY_ADMIN_PASSWORD',
  'DOX_ADMIN_PASSWORD',
  'THALLY_ACCESS_PASSWORD',
  'DOX_ACCESS_PASSWORD',
  'THALLY_ANALYTICS_SECRET',
  'DOX_ANALYTICS_SECRET',
] as const

function clearSecrets() {
  for (const key of SECRET_ENV_KEYS) vi.stubEnv(key, '')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('production signing secrets', () => {
  it('rejects a docs cookie forged with the public development key', async () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'production')
    const payload = Buffer.from(
      JSON.stringify({ exp: Date.now() + 60_000, scope: 'docs' }),
    ).toString('base64url')
    const signature = createHmac('sha256', 'thally-dev-admin')
      .update(payload)
      .digest('base64url')

    await expect(
      isDocsAccessGrantedEdge(`${payload}.${signature}`, true),
    ).resolves.toBe(false)
    expect(getAdminSigningSecret()).toBeNull()
    await expect(getInternalAnalyticsSecretEdge()).resolves.toBeNull()
  })

  it('keeps docs and admin signing domains separate', async () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ACCESS_PASSWORD', 'unique-docs-password')

    expect(getDocsSigningSecret()).toBe('unique-docs-password')
    expect(getAdminSigningSecret()).toBeNull()

    const payload = Buffer.from(
      JSON.stringify({ exp: Date.now() + 60_000, scope: 'admin' }),
    ).toString('base64url')
    const signature = createHmac('sha256', 'unique-docs-password')
      .update(payload)
      .digest('base64url')
    await expect(isAdminAuthenticatedEdge(`${payload}.${signature}`)).resolves.toBe(false)
  })

  it('does not expose the docs password as the analytics credential', async () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ACCESS_PASSWORD', 'reader-visible-password')

    await expect(getInternalAnalyticsSecretEdge()).resolves.toBeNull()
  })

  it('derives analytics authentication without reusing the admin credential', async () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ADMIN_PASSWORD', 'private-admin-password')

    const analyticsSecret = await getInternalAnalyticsSecretEdge()
    expect(analyticsSecret).toHaveLength(43)
    expect(analyticsSecret).not.toBe('private-admin-password')
  })

  it('retains the zero-config key outside production only', () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'test')

    expect(getAdminSigningSecret()).toBe('thally-dev-admin')
    expect(getDocsSigningSecret()).toBe('thally-dev-docs')
  })
})
