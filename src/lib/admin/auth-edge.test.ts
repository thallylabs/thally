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
  'THALLY_ACCESS_SECRET',
  'DOX_ACCESS_SECRET',
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
    vi.stubEnv('THALLY_ACCESS_SECRET', 'high-entropy-docs-signing-secret')

    expect(getDocsSigningSecret()).toBe('high-entropy-docs-signing-secret')
    expect(getAdminSigningSecret()).toBeNull()

    const payload = Buffer.from(
      JSON.stringify({ exp: Date.now() + 60_000, scope: 'admin' }),
    ).toString('base64url')
    const signature = createHmac('sha256', 'high-entropy-docs-signing-secret')
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
    vi.stubEnv('THALLY_ADMIN_SECRET', 'high-entropy-admin-signing-secret')

    const analyticsSecret = await getInternalAnalyticsSecretEdge()
    expect(analyticsSecret).toHaveLength(43)
    expect(analyticsSecret).not.toBe('private-admin-password')
  })

  it('never derives a production signing key from a human password', () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('THALLY_ADMIN_PASSWORD', 'guessable-admin-password')
    vi.stubEnv('THALLY_ACCESS_PASSWORD', 'guessable-docs-password')

    expect(getAdminSigningSecret()).toBeNull()
    expect(getDocsSigningSecret()).toBeNull()
  })

  it('retains the zero-config key outside production only', () => {
    clearSecrets()
    vi.stubEnv('NODE_ENV', 'test')

    expect(getAdminSigningSecret()).toBe('thally-dev-admin')
    expect(getDocsSigningSecret()).toBe('thally-dev-docs')
  })
})
