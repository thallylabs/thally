/**
 * Managed content cache headers: under THALLY_CONTENT_SOURCE=assets, doc
 * responses must carry `Cache-Tag: site:{siteId}` (the purge handle for
 * content publishes) plus a long CDN TTL — and must NOT leak onto admin
 * surfaces, non-content APIs, gated sites, or the default filesystem mode.
 * Also regression-checks that pass-through and rewrite behavior is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: () => 'analytics-secret',
  isAdminAuthenticatedEdge: vi.fn().mockResolvedValue(false),
  isAdminEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessGrantedEdge: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/traffic-classifier', () => ({
  // Doc-page paths are tracked, so the analytics branch runs during these
  // tests — the classification must be shaped, and fetch is stubbed below.
  classifyRequest: vi
    .fn()
    .mockReturnValue({ visitorType: 'human', agentSignal: null, format: 'html' }),
  isAgentRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/agent-endpoints', () => ({
  isMachineEndpoint: vi.fn().mockReturnValue(false),
  isPublicAgentEndpoint: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/cloud-link/edge', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cloud-link/edge')>('@/lib/cloud-link/edge')
  return {
    getCloudAccessConfigEdge: vi.fn().mockResolvedValue(null),
    // Real implementation: it only parses THALLY_CLOUD_SITE_CONFIG from env.
    getManagedSiteIdEdge: actual.getManagedSiteIdEdge,
  }
})

import { middleware } from '@/middleware'
import { isDocsAccessEnabledEdge, isDocsAccessGrantedEdge } from '@/lib/admin/auth-edge'
import { getCloudAccessConfigEdge } from '@/lib/cloud-link/edge'
import { classifyRequest, isAgentRequest } from '@/lib/traffic-classifier'

const EVENT = { waitUntil: vi.fn() } as never

function docRequest(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`https://docs.example.com${path}`, { headers })
}

const savedContentSource = process.env.THALLY_CONTENT_SOURCE
const savedSiteConfig = process.env.THALLY_CLOUD_SITE_CONFIG

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDocsAccessEnabledEdge).mockReturnValue(false)
  vi.mocked(isAgentRequest).mockReturnValue(false)
  vi.mocked(classifyRequest).mockReturnValue({
    visitorType: 'human',
    agentSignal: null,
    format: 'html',
  } as never)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null)) as never
  delete process.env.THALLY_CONTENT_SOURCE
  delete process.env.THALLY_CLOUD_SITE_CONFIG
})

afterEach(() => {
  fetchSpy.mockRestore()
  if (savedContentSource === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = savedContentSource
  if (savedSiteConfig === undefined) delete process.env.THALLY_CLOUD_SITE_CONFIG
  else process.env.THALLY_CLOUD_SITE_CONFIG = savedSiteConfig
})

/**
 * Managed assets mode with the access config affirmatively public — the only
 * configuration in which cache headers may be emitted.
 */
function enableManagedAssetsMode(): void {
  process.env.THALLY_CONTENT_SOURCE = 'assets'
  process.env.THALLY_CLOUD_SITE_CONFIG = JSON.stringify({ siteId: 'site_123' })
  vi.mocked(getCloudAccessConfigEdge).mockResolvedValue({ access: { mode: 'public' } })
}

describe('managed content cache headers', () => {
  it('adds Cache-Tag and a long CDN TTL to doc pages in assets mode', async () => {
    enableManagedAssetsMode()
    const response = await middleware(docRequest('/getting-started'), EVENT)

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Tag')).toBe('site:site_123')
    expect(response.headers.get('CDN-Cache-Control')).toBe('public, s-maxage=31536000')
    // Existing doc-page headers survive alongside the cache headers.
    expect(response.headers.get('X-Llms-Txt')).toBe('https://docs.example.com/llms.txt')
  })

  it('tags the .md mirror rewrite so publishes purge it too', async () => {
    enableManagedAssetsMode()
    const response = await middleware(docRequest('/getting-started.md'), EVENT)

    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/markdown/getting-started')
    expect(response.headers.get('Cache-Tag')).toBe('site:site_123')
  })

  it('tags the agent content-negotiation rewrite but never CDN-caches it', async () => {
    enableManagedAssetsMode()
    vi.mocked(isAgentRequest).mockReturnValue(true)
    const response = await middleware(docRequest('/getting-started'), EVENT)

    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/docs/getting-started')
    expect(response.headers.get('Cache-Tag')).toBe('site:site_123')
    // This response varies on User-Agent/Accept under the BROWSER URL's cache
    // key. A CDN TTL here would let the first requester poison the page for
    // everyone (CDNs do not honor Vary on those headers).
    expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  })

  it('never tags in the default filesystem mode', async () => {
    const response = await middleware(docRequest('/getting-started'), EVENT)

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Tag')).toBeNull()
    expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  })

  it('never tags without an injected siteId', async () => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    const response = await middleware(docRequest('/getting-started'), EVENT)

    expect(response.headers.get('Cache-Tag')).toBeNull()
  })

  it('never tags non-content API or admin surfaces', async () => {
    enableManagedAssetsMode()

    const search = await middleware(docRequest('/api/search'), EVENT)
    expect(search.headers.get('Cache-Tag')).toBeNull()

    const admin = await middleware(docRequest('/admin'), EVENT)
    expect(admin.headers.get('Cache-Tag')).toBeNull()
  })

  it('never emits cache headers when the access config is unavailable (fail closed)', async () => {
    // Grant exchange failed or timed out: request gating fails open for
    // availability, but a possibly-gated page must not enter a shared cache.
    enableManagedAssetsMode()
    vi.mocked(getCloudAccessConfigEdge).mockResolvedValue(null)

    const response = await middleware(docRequest('/getting-started'), EVENT)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Tag')).toBeNull()
    expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  })

  it('never emits cache headers when the managed site is password-gated', async () => {
    enableManagedAssetsMode()
    vi.mocked(getCloudAccessConfigEdge).mockResolvedValue({ access: { mode: 'password' } })
    vi.mocked(isDocsAccessGrantedEdge).mockResolvedValue(true)

    const response = await middleware(docRequest('/getting-started'), EVENT)
    expect(response.headers.get('Cache-Tag')).toBeNull()
    expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  })

  it('never tags while docs-access protection is on (no shared cache of gated pages)', async () => {
    enableManagedAssetsMode()
    vi.mocked(isDocsAccessEnabledEdge).mockReturnValue(true)
    vi.mocked(isDocsAccessGrantedEdge).mockResolvedValue(true)

    const response = await middleware(docRequest('/getting-started'), EVENT)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Tag')).toBeNull()
  })

  it('leaves RSC navigation requests passing through untouched (regression)', async () => {
    enableManagedAssetsMode()
    const response = await middleware(
      docRequest('/getting-started', {
        rsc: '1',
        'next-router-state-tree': '%5B%22%22%5D',
      }),
      EVENT,
    )

    // Client-side navigation must never be rewritten or redirected.
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
