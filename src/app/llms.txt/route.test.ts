/** End-to-end contract coverage for every canonical page emitted by llms.txt. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: vi.fn().mockResolvedValue(null),
  getManagedSiteIdEdge: vi.fn().mockReturnValue(undefined),
}))

vi.mock('@/lib/site-config', () => ({
  resolveSiteConfig: vi.fn().mockResolvedValue({
    name: 'Example Docs',
    description: 'Example documentation',
    repoUrl: '',
    links: [],
  }),
}))

import { GET as getDocument } from '@/app/api/docs/[...slug]/route'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { loadDocEntries } from '@/data/docs'
import { middleware } from '@/middleware'

const BASE_URL = 'http://localhost:3040'
const EVENT = { waitUntil: vi.fn() } as never

const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null)) as never
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

interface RepresentationCase {
  accept: string
  contentType: string
  format: 'markdown' | 'json' | 'ldjson'
}

const REPRESENTATIONS: Array<RepresentationCase> = [
  { accept: '*/*', contentType: 'text/markdown', format: 'markdown' },
  { accept: 'text/markdown', contentType: 'text/markdown', format: 'markdown' },
  { accept: 'application/json', contentType: 'application/json', format: 'json' },
  { accept: 'application/ld+json', contentType: 'application/ld+json', format: 'ldjson' },
]

describe('llms.txt canonical page matrix', () => {
  it('serves every emitted page under wildcard, HTML, Markdown, JSON, and JSON-LD Accept values', async () => {
    const llmsResponse = await getLlmsTxt(new Request(`${BASE_URL}/llms.txt`))
    const llmsBody = await llmsResponse.text()
    const pageUrls = Array.from(
      llmsBody.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)]+)\)/gm),
      (match) => match[1],
    )
    const entriesByHref = new Map((await loadDocEntries()).map((entry) => [entry.href, entry]))

    expect(pageUrls.length).toBeGreaterThan(0)
    expect(pageUrls).toContain(`${BASE_URL}/api/overview`)

    for (const pageUrl of pageUrls) {
      const url = new URL(pageUrl)
      const entry = entriesByHref.get(url.pathname)
      expect(entry, `${url.pathname} must resolve to a published document`).toBeDefined()

      for (const accept of ['*/*', 'text/html']) {
        const response = await middleware(
          new NextRequest(pageUrl, { headers: { accept } }),
          EVENT,
        )
        expect(
          response.headers.get('x-middleware-next'),
          `${url.pathname} must reach its HTML route for Accept: ${accept}`,
        ).toBe('1')
      }

      for (const representation of REPRESENTATIONS) {
        const response = await getDocument(
          new NextRequest(`${BASE_URL}/api/docs/${entry!.id}`, {
            headers: { accept: representation.accept },
          }),
          { params: Promise.resolve({ slug: entry!.id.split('/') }) },
        )
        const body = await response.text()

        expect(response.status, `${url.pathname} ${representation.accept}`).toBe(200)
        expect(
          response.headers.get('content-type'),
          `${url.pathname} ${representation.accept}`,
        ).toContain(representation.contentType)
        if (representation.format === 'markdown') {
          expect(body.startsWith('---\n'), `${url.pathname} must serialize Markdown`).toBe(true)
        } else {
          expect(() => JSON.parse(body), `${url.pathname} must serialize JSON`).not.toThrow()
        }
      }

      for (const accept of ['text/markdown', 'application/json', 'application/ld+json']) {
        const response = await middleware(
          new NextRequest(pageUrl, { headers: { accept } }),
          EVENT,
        )
        expect(
          response.headers.get('x-middleware-rewrite'),
          `${url.pathname} must negotiate Accept: ${accept}`,
        ).toContain(`/api/docs/${entry!.id}`)
      }
    }
  })
})
