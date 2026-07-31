/** Page-feedback route coverage for the public-to-Cloud analytics contract. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudSiteConfig: vi.fn(),
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/cloud-bridge', () => ({
  recordAnalyticsEvent: mocks.recordAnalyticsEvent,
}))
vi.mock('@/lib/cloud-link/client', () => ({
  getCloudSiteConfig: mocks.getCloudSiteConfig,
}))

import { POST } from './route'

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudSiteConfig.mockResolvedValue({
      siteConfig: {
        portable: {
          feedback: { thumbsRating: true },
        },
      },
    })
    mocks.recordAnalyticsEvent.mockResolvedValue(undefined)
  })

  it.each(['yes', 'no'] as const)(
    'forwards a %s vote with a path-only analytics destination',
    async (vote) => {
      const response = await POST(
        new Request('https://docs.example.com/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            page: '/api-reference/get-comment',
            vote,
            url: 'https://docs.example.com/api-reference/get-comment?preview=secret#response',
          }),
        }),
      )

      expect(response.status).toBe(200)
      expect(mocks.recordAnalyticsEvent).toHaveBeenCalledWith({
        type: 'feedback',
        path: '/api-reference/get-comment',
        page: '/api-reference/get-comment',
        referer:
          'https://docs.example.com/api-reference/get-comment?preview=secret#response',
        vote,
        message: undefined,
        visitorType: 'human',
      })
    },
  )
})
