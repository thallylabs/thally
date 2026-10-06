/**
 * Reader-auth middleware regressions, including App Router navigation.
 *
 * Reader auth only ADDS cache headers in middleware: per-page decisions need
 * frontmatter, which the edge runtime cannot read, so enforcement lives in the
 * node routes. These tests pin that middleware never redirects or rewrites a
 * document or RSC payload because of reader auth, keeps the existing
 * negotiation behavior, and stops every shared cache from keeping a
 * reader-specific representation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ readerAuthActive: true }))

vi.mock('@/lib/reader-auth/config', () => ({ isReaderAuthActive: () => state.readerAuthActive }))
vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: vi.fn().mockResolvedValue(null),
  isAdminAuthenticatedEdge: vi.fn().mockResolvedValue(false),
  isAdminEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessGrantedEdge: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 'session', verifySession: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/traffic-classifier', () => ({
  classifyRequest: vi.fn().mockReturnValue({ visitorType: 'bot', agentSignal: null, format: 'html' }),
  isAgentRequest: vi.fn((request: NextRequest) => request.headers.get('accept')?.includes('text/markdown') === true),
}))
vi.mock('@/lib/cloud-link/edge', () => ({
  // Even a Cloud grant that says "public" must not make reader-specific pages cacheable.
  getCloudAccessConfigEdge: vi.fn().mockResolvedValue({ access: { mode: 'public' } }),
  getManagedSiteIdEdge: vi.fn().mockReturnValue('site_1'),
}))

import { middleware } from '@/middleware'

const EVENT = { waitUntil: vi.fn() } as never
const RSC_HEADERS = { rsc: '1', 'next-router-state-tree': '%5B%22%22%5D' }
const PREFETCH_HEADERS = { ...RSC_HEADERS, 'next-router-prefetch': '1' }

function request(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`https://docs.example.com${path}`, { headers })
}

beforeEach(() => {
  state.readerAuthActive = true
  vi.stubEnv('THALLY_CONTENT_SOURCE', 'assets')
})

afterEach(() => vi.unstubAllEnvs())

describe('reader auth in middleware', () => {
  it.each([
    ['a full HTML document', '/guides/secret', { accept: 'text/html' }],
    ['an RSC navigation payload', '/guides/secret', RSC_HEADERS],
    ['an RSC prefetch', '/guides/secret', PREFETCH_HEADERS],
    ['the RSC query marker', '/guides/secret?_rsc=abc', {}],
  ])('passes %s straight through with only header changes', async (_label, path, headers) => {
    const response = await middleware(request(path, headers), EVENT)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect(response.status).toBe(200)
    // Discovery headers are still advertised on documents.
    expect(response.headers.get('Link')).toContain('rel="llms-txt"')
  })

  it.each([
    ['/guides/secret', { accept: 'text/html' }],
    ['/guides/secret', RSC_HEADERS],
    ['/llms.txt', {}],
    ['/llms-full.txt', {}],
    ['/api/docs-index', {}],
    ['/api/search', {}],
    ['/api/mcp', {}],
    ['/sitemap.xml', {}],
  ])('keeps %s out of every shared cache', async (path, headers) => {
    const response = await middleware(request(path, headers), EVENT)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('CDN-Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Cache-Tag')).toBeNull()
  })

  it('keeps the .md mirror rewrite and makes it private', async () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({ tabs: [], markdown: { enabled: true } }))
    const response = await middleware(request('/guides/secret.md'), EVENT)
    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/markdown/guides/secret')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('keeps agent negotiation rewrites and makes them private', async () => {
    const response = await middleware(request('/guides/secret', { accept: 'text/markdown' }), EVENT)
    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/docs/guides/secret')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('never gates the sign-in routes', async () => {
    for (const path of ['/api/reader/login', '/api/reader/jwt', '/api/reader/oidc/callback', '/login/jwt-callback']) {
      const response = await middleware(request(path), EVENT)
      expect(response.headers.get('location')).toBeNull()
      expect(response.status).toBe(200)
    }
  })

  it('leaves framework assets cacheable', async () => {
    const response = await middleware(request('/_next/static/chunks/app.js'), EVENT)
    expect(response.headers.get('Cache-Control')).toBeNull()
  })

  it('restores public CDN caching when reader auth is off', async () => {
    state.readerAuthActive = false
    const response = await middleware(request('/guides/open', { accept: 'text/html' }), EVENT)
    expect(response.headers.get('CDN-Cache-Control')).toContain('s-maxage=31536000')
    expect(response.headers.get('Cache-Tag')).toBe('site:site_1')
    const rsc = await middleware(request('/guides/open', RSC_HEADERS), EVENT)
    expect(rsc.headers.get('x-middleware-next')).toBe('1')
    expect(rsc.headers.get('CDN-Cache-Control')).toBeNull()
  })
})
