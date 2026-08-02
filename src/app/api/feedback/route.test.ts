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

  it('records a written negative follow-up without counting another vote', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue({
      siteConfig: {
        portable: {
          feedback: { thumbsRating: true, pageFeedback: true },
        },
      },
    })

    const response = await POST(
      new Request('https://docs.example.com/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          page: '/guides/install',
          vote: 'no',
          message: '  Explain the required Node version.  ',
          followUp: true,
          url: 'https://docs.example.com/guides/install',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.recordAnalyticsEvent).toHaveBeenCalledWith({
      type: 'feedback',
      path: '/guides/install',
      page: '/guides/install',
      referer: 'https://docs.example.com/guides/install',
      vote: undefined,
      message: 'Explain the required Node version.',
      visitorType: 'human',
    })
  })

  it.each([
    { page: '/guide', vote: 'maybe' },
    { page: '/guide', vote: 'yes', message: 'More examples', followUp: true },
    { page: '/guide', vote: 'no', message: '   ', followUp: true },
  ])('rejects an invalid feedback path %#', async (body) => {
    const response = await POST(
      new Request('https://docs.example.com/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.recordAnalyticsEvent).not.toHaveBeenCalled()
  })
})
