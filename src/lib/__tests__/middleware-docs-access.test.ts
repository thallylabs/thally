/** Docs-access regressions for browser and machine-readable content surfaces. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: vi.fn().mockResolvedValue(null),
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
  classifyRequest: vi.fn().mockReturnValue({
    visitorType: 'bot',
    agentSignal: null,
    format: 'html',
  }),
  isAgentRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: vi.fn().mockResolvedValue({ access: { mode: 'password' } }),
  getManagedSiteIdEdge: vi.fn().mockReturnValue(null),
}))

import { middleware } from '@/middleware'
import { isDocsAccessGrantedEdge } from '@/lib/admin/auth-edge'
import { getCloudAccessConfigEdge } from '@/lib/cloud-link/edge'

const EVENT = { waitUntil: vi.fn() } as never

function request(path: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`https://docs.example.com${path}`, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCloudAccessConfigEdge).mockResolvedValue({ access: { mode: 'password' } })
  vi.mocked(isDocsAccessGrantedEdge).mockResolvedValue(false)
})

describe('password-protected content surfaces', () => {
  it.each([
    '/robots.txt',
    '/ai.txt',
    '/skill.md',
    '/auth.md',
    '/.well-known/mcp.json',
    '/.well-known/oauth-protected-resource',
  ])('preserves anonymous discovery at %s', async (path) => {
    const response = await middleware(request(path), EVENT)

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store')
  })

  it.each([
    '/llms.txt',
    '/llms-full.txt',
    '/.well-known/llms.txt',
    '/AGENTS.md',
    '/sitemap.xml',
    '/openapi.json',
    '/openapi.yaml',
    '/changelog/rss.xml',
    '/guides/private.md',
    '/api/docs-index',
    '/api/docs/guides/private',
    '/api/markdown/guides/private',
    '/api/search',
    '/api/mcp',
    '/api/agent-readiness',
  ])('returns a non-cacheable machine 401 at %s', async (path) => {
    const response = await middleware(request(path), EVENT)
    const problem = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('CDN-Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('private, no-store')
    expect(problem).toMatchObject({ code: 'docs_access_required', instance: path })
  })

  it('keeps browser redirects private and non-cacheable', async () => {
    const response = await middleware(
      request('/guides/private', { accept: 'text/html' }),
      EVENT,
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/access?next=%2Fguides%2Fprivate')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('CDN-Cache-Control')).toBe('private, no-store')
  })

  it.each(['/llms.txt', '/api/docs-index', '/guides/private.md', '/guides/private']) (
    'forces successful protected responses private at %s',
    async (path) => {
      vi.mocked(isDocsAccessGrantedEdge).mockResolvedValue(true)
      const response = await middleware(request(path), EVENT)

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Cache-Tag')).toBeNull()
    },
  )

  it('leaves content projections public when docs access is public', async () => {
    vi.mocked(getCloudAccessConfigEdge).mockResolvedValue({ access: { mode: 'public' } })
    const response = await middleware(request('/llms.txt'), EVENT)

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store')
  })
})
