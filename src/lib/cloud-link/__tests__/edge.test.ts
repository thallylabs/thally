/** Edge-runtime coverage for release-scoped managed site configuration. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCloudAccessConfigEdge } from '../edge'

describe('Thally Cloud edge configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads managed password policy without exchanging a site credential', async () => {
    vi.stubEnv(
      'THALLY_CLOUD_SITE_CONFIG',
      JSON.stringify({
        siteId: 'site-managed',
        orgId: 'org-1',
        entitlements: { features: { passwordProtection: true } },
        siteConfig: {
          portable: {},
          access: { mode: 'password', passwordHash: 'salt:hash' },
        },
      }),
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      getCloudAccessConfigEdge('https://docs.example.com'),
    ).resolves.toEqual({
      portable: {},
      access: { mode: 'password', passwordHash: 'salt:hash' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed for a malformed managed snapshot', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', '{not-json')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      getCloudAccessConfigEdge('https://docs.example.com'),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
