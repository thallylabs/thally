/** Paid-service adapter gating and server-only credential coverage. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudServiceGrant: vi.fn(),
  getCloudSiteConfig: vi.fn(),
  getRelevantChunks: vi.fn(),
}))

vi.mock('../client', () => ({
  getCloudServiceGrant: mocks.getCloudServiceGrant,
  getCloudSiteConfig: mocks.getCloudSiteConfig,
}))
vi.mock('@thallylabs/core', () => ({
  getRelevantChunks: mocks.getRelevantChunks,
}))

import {
  isCloudAiAvailable,
  recordCloudAnalyticsEvent,
} from '../services'

const cloudConfig = {
  siteId: 'site-1',
  orgId: 'org-1',
  entitlements: { features: { aiAnswers: true, analytics: true } },
  siteConfig: {
    portable: {
      ai: { enabled: true },
      analytics: { enabled: true, collectAgentTraffic: true },
    },
    access: { mode: 'public', passwordHash: null },
  },
}

describe('Thally Cloud service adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.getCloudSiteConfig.mockResolvedValue(cloudConfig)
    mocks.getCloudServiceGrant.mockResolvedValue('release-grant')
  })

  it('requires entitlement, setting, and a service grant for AI visibility', async () => {
    await expect(isCloudAiAvailable('https://docs.example.com')).resolves.toBe(true)
    mocks.getCloudServiceGrant.mockResolvedValue(null)
    await expect(isCloudAiAvailable('https://docs.example.com')).resolves.toBe(false)
  })

  it('posts analytics with the server-only release grant', async () => {
    vi.stubEnv('THALLY_CLOUD_URL', 'https://cloud.example.com')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 202 }),
    )

    await recordCloudAnalyticsEvent('https://docs.example.com', {
      type: 'page_view',
      path: '/quickstart',
      visitorType: 'human',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cloud.example.com/api/runtime/analytics'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer release-grant' }),
      }),
    )
  })

  it('does not send disabled agent analytics', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue({
      ...cloudConfig,
      siteConfig: {
        ...cloudConfig.siteConfig,
        portable: {
          ...cloudConfig.siteConfig.portable,
          analytics: { enabled: true, collectAgentTraffic: false },
        },
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await recordCloudAnalyticsEvent('https://docs.example.com', {
      type: 'page_view',
      path: '/llms.txt',
      visitorType: 'agent',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.getCloudServiceGrant).not.toHaveBeenCalled()
  })
})
