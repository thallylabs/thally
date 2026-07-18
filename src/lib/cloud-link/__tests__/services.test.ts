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
  registerContentDocumentSource: vi.fn(),
  registerDocEntriesSource: vi.fn(),
}))

import {
  handleCloudAiChat,
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

  it('retrieves context before forwarding a managed AI chat request', async () => {
    vi.stubEnv('THALLY_CLOUD_URL', 'https://cloud.example.com')
    mocks.getRelevantChunks.mockResolvedValue([
      {
        score: 0.9,
        chunk: {
          pageId: 'quickstart',
          title: 'Quickstart',
          headingPath: ['Install'],
          href: '/quickstart',
          anchor: 'install',
          text: 'Install the package.',
          tokens: 4,
        },
      },
    ])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Grounded answer', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    )

    const response = await handleCloudAiChat(
      new Request('https://docs.example.com/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'How do I install?' }] }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.getRelevantChunks).toHaveBeenCalledWith('How do I install?', {
      k: 8,
      tokenBudget: 4_000,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cloud.example.com/api/runtime/chat'),
      expect.objectContaining({
        body: expect.stringContaining('Install the package.'),
      }),
    )
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
