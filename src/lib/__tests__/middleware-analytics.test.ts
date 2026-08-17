/** End-to-end middleware analytics payload and bot-filtering coverage. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: () => 'analytics-secret',
  isAdminAuthenticatedEdge: vi.fn().mockResolvedValue(false),
  isAdminEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessGrantedEdge: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: vi.fn().mockResolvedValue(null),
  getManagedSiteIdEdge: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/agent-endpoints', () => ({
  isMachineEndpoint: vi.fn().mockReturnValue(false),
  isPublicAgentEndpoint: vi.fn().mockReturnValue(false),
}))

import { middleware } from '@/middleware'

function analyticsEvent() {
  let pending: Promise<unknown> | undefined
  return {
    event: {
      waitUntil(value: Promise<unknown>) {
        pending = value
      },
    } as never,
    wait: async () => pending,
  }
}

describe('middleware analytics collection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a daily anonymous visitor key and external hostname only', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))
    const tracker = analyticsEvent()

    await middleware(
      new NextRequest('https://docs.example.com/quickstart', {
        headers: {
          accept: 'text/html',
          referer: 'https://www.google.com/search?q=private#result',
          'user-agent': 'Mozilla/5.0 ExampleBrowser/1.0',
          'x-nf-client-connection-ip': '203.0.113.8',
        },
      }),
      tracker.event,
    )
    await tracker.wait()

    expect(fetchSpy).toHaveBeenCalledOnce()
    const init = fetchSpy.mock.calls[0]?.[1]
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      type: 'page_view',
      path: '/quickstart',
      visitorType: 'human',
      referrerDomain: 'google.com',
    })
    expect(payload.visitorKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(payload).not.toHaveProperty('referer')
  })

  it('does not send ordinary crawler traffic to analytics storage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))
    const tracker = analyticsEvent()

    await middleware(
      new NextRequest('https://docs.example.com/quickstart', {
        headers: {
          accept: 'text/html',
          'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
          'x-nf-client-connection-ip': '203.0.113.8',
        },
      }),
      tracker.event,
    )
    await tracker.wait()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
