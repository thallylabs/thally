/** Docs password throttling must run before config lookup and scrypt work. */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({
  DOCS_ACCESS_COOKIE: 'docs-access',
  createDocsAccessToken: vi.fn(),
  isDocsAccessEnabled: vi.fn(),
  verifyDocsAccessPasswordAsync: vi.fn(),
}))
vi.mock('@/lib/admin/auth-rate-limit', () => ({
  reserveAuthAttempt: vi.fn(),
  resetAuthAttempts: vi.fn(),
}))
vi.mock('@/lib/admin/secrets', () => ({ verifyPasswordHash: vi.fn() }))
vi.mock('@/lib/cloud-link/client', () => ({ getCloudSiteConfig: vi.fn() }))

import { POST } from './route'
import { reserveAuthAttempt } from '@/lib/admin/auth-rate-limit'
import { verifyDocsAccessPasswordAsync } from '@/lib/admin/auth'
import { verifyPasswordHash } from '@/lib/admin/secrets'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reserveAuthAttempt).mockReturnValue({
    allowed: true,
    key: 'docs:192.0.2.1',
    retryAfter: 60,
  })
})

describe('POST /api/access/auth', () => {
  it('returns 429 with Retry-After before config lookup or either verifier', async () => {
    vi.mocked(reserveAuthAttempt).mockReturnValue({
      allowed: false,
      key: 'docs:192.0.2.1',
      retryAfter: 41,
    })
    const response = await POST(new NextRequest('https://docs.example.com/api/access/auth', {
      method: 'POST',
      body: JSON.stringify({ password: 'expensive-secret' }),
    }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('41')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(getCloudSiteConfig).not.toHaveBeenCalled()
    expect(verifyPasswordHash).not.toHaveBeenCalled()
    expect(verifyDocsAccessPasswordAsync).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared body before config lookup or verification', async () => {
    const response = await POST(new NextRequest('https://docs.example.com/api/access/auth', {
      method: 'POST',
      headers: { 'content-length': '9000' },
      body: '{}',
    }))

    expect(response.status).toBe(413)
    expect(getCloudSiteConfig).not.toHaveBeenCalled()
    expect(verifyPasswordHash).not.toHaveBeenCalled()
  })

  it('rejects an oversized chunked body before config lookup or verification', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5_000))
        controller.enqueue(new Uint8Array(5_000))
      },
    })
    const response = await POST(new Request('https://docs.example.com/api/access/auth', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit) as NextRequest)

    expect(response.status).toBe(413)
    expect(getCloudSiteConfig).not.toHaveBeenCalled()
    expect(verifyDocsAccessPasswordAsync).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON before config lookup or verification', async () => {
    const response = await POST(new NextRequest('https://docs.example.com/api/access/auth', {
      method: 'POST',
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
    expect(getCloudSiteConfig).not.toHaveBeenCalled()
    expect(verifyDocsAccessPasswordAsync).not.toHaveBeenCalled()
  })
})
