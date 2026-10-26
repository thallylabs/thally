/** Locale transport must not rewrite App Router requests or trust visitor headers. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session', DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: () => '',
  isAdminAuthenticatedEdge: async () => false,
  isAdminEnabledEdge: () => false,
  isDocsAccessEnabledEdge: () => false,
  isDocsAccessGrantedEdge: async () => false,
}))
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 'session', verifySession: async () => null }))
vi.mock('@/lib/cloud-link/edge', () => ({ getCloudAccessConfigEdge: async () => null, getManagedSiteIdEdge: () => null }))
vi.mock('@/lib/reader-auth/config', () => ({ isReaderAuthActive: () => false }))

import { middleware } from '@/middleware'
import { DOCUMENT_PATH_HEADER } from '@/lib/i18n/document-path'

beforeEach(() => vi.clearAllMocks())

async function request(headers: Record<string, string> = {}) {
  return middleware(new NextRequest('https://docs.example.test/es/quickstart', {
    headers: { 'user-agent': 'Mozilla/5.0', [DOCUMENT_PATH_HEADER]: '/fr/attacker', ...headers },
  }), { waitUntil: vi.fn() } as never)
}

describe('document locale request transport', () => {
  it('replaces a spoofed pathname and retains the existing full-HTML cache policy', async () => {
    const response = await request({ accept: 'text/html' })
    expect(response.headers.get(`x-middleware-request-${DOCUMENT_PATH_HEADER}`)).toBe('/es/quickstart')
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('CDN-Cache-Control')).toContain('s-maxage=31536000')
  })

  it.each(['rsc', 'next-router-state-tree', 'next-router-prefetch'])('preserves the %s navigation bypass', async signal => {
    const response = await request({ [signal]: '1', accept: 'text/x-component' })
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get(`x-middleware-request-${DOCUMENT_PATH_HEADER}`)).toBe('/es/quickstart')
    expect(response.headers.get(`x-middleware-request-${signal}`)).toBe('1')
    expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  })
})
