/** Server-only Thally Cloud grant exchange, cache, and runtime config behavior. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectCloudSite,
  getCloudGrant,
  getCloudSiteConfig,
  resetCloudGrantCacheForTests,
} from '../client'

function unsignedGrant(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.`
}

describe('Thally Cloud link client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetCloudGrantCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is a safe no-op when no site credential is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(connectCloudSite('https://docs.example.com')).resolves.toEqual({
      status: 'not_configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges the server-only token and reports the deployment URL', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'thally_site_secret')
    vi.stubEnv('THALLY_CLOUD_URL', 'https://cloud.example.com/control')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ grant: 'signed-grant' }))

    const result = await connectCloudSite('https://docs.example.com')

    expect(result).toEqual({ status: 'connected' })
    expect(JSON.stringify(result)).not.toContain('thally_site_secret')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://cloud.example.com/control/api/cloud/grant')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer thally_site_secret',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      siteUrl: 'https://docs.example.com',
    })
  })

  it('reuses the short-lived grant without repeating a control-plane request', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'thally_site_secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ grant: 'signed-grant' }))

    await expect(getCloudGrant('https://docs.example.com')).resolves.toBe('signed-grant')
    await expect(getCloudGrant('https://docs.example.com')).resolves.toBe('signed-grant')
    await expect(connectCloudSite('https://docs.example.com')).resolves.toEqual({
      status: 'connected',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('distinguishes rejected credentials from unreachable Thally Cloud without throwing', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'thally_site_secret')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'invalid_token' }, { status: 401 }))

    await expect(connectCloudSite('https://docs.example.com')).resolves.toEqual({
      status: 'credential_rejected',
    })
  })

  it('fails safely when the configured control-plane URL is invalid', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'thally_site_secret')
    vi.stubEnv('THALLY_CLOUD_URL', 'not a url')

    await expect(connectCloudSite('https://docs.example.com')).resolves.toEqual({
      status: 'cloud_unreachable',
    })
  })

  it('decodes portable settings and server-only access policy from a grant', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'thally_site_secret')
    const payload = {
      siteId: 'site-1',
      orgId: 'org-1',
      exp: Math.floor(Date.now() / 1000) + 300,
      entitlements: { features: { passwordProtection: true, analytics: true } },
      siteConfig: {
        portable: { analytics: { enabled: false }, branding: { themePreset: 'sharp' } },
        access: { mode: 'password', passwordHash: 'salt:hash' },
      },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ grant: unsignedGrant(payload) }),
    )

    await expect(getCloudSiteConfig('https://docs.example.com')).resolves.toMatchObject(payload)
  })
})
