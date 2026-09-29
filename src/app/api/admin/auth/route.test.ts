/** Admin password throttling must run before password verification. */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  createAdminSessionToken: vi.fn(),
  isAdminEnabled: vi.fn().mockReturnValue(true),
  verifyAdminPassword: vi.fn(),
}))
vi.mock('@/lib/admin/auth-rate-limit', () => ({
  reserveAuthAttempt: vi.fn(),
  resetAuthAttempts: vi.fn(),
}))
vi.mock('@/lib/auth/rbac', () => ({ resolveAdminFromRequest: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 'session' }))
vi.mock('@/lib/auth/oidc', () => ({ getOidcConfig: vi.fn() }))

import { POST } from './route'
import { verifyAdminPassword } from '@/lib/admin/auth'
import { reserveAuthAttempt } from '@/lib/admin/auth-rate-limit'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reserveAuthAttempt).mockReturnValue({
    allowed: true,
    key: 'admin:192.0.2.1',
    retryAfter: 60,
  })
})

describe('POST /api/admin/auth', () => {
  it('returns 429 with Retry-After before checking the password', async () => {
    vi.mocked(reserveAuthAttempt).mockReturnValue({
      allowed: false,
      key: 'admin:192.0.2.1',
      retryAfter: 37,
    })
    const response = await POST(new NextRequest('https://docs.example.com/api/admin/auth', {
      method: 'POST',
      body: JSON.stringify({ password: 'expensive-secret' }),
    }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('37')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(verifyAdminPassword).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared body before checking the password', async () => {
    const response = await POST(new NextRequest('https://docs.example.com/api/admin/auth', {
      method: 'POST',
      headers: { 'content-length': '9000' },
      body: '{}',
    }))

    expect(response.status).toBe(413)
    expect(verifyAdminPassword).not.toHaveBeenCalled()
  })

  it('rejects an oversized chunked body before checking the password', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5_000))
        controller.enqueue(new Uint8Array(5_000))
      },
    })
    const response = await POST(new Request('https://docs.example.com/api/admin/auth', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit) as NextRequest)

    expect(response.status).toBe(413)
    expect(verifyAdminPassword).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON without checking the password', async () => {
    const response = await POST(new NextRequest('https://docs.example.com/api/admin/auth', {
      method: 'POST',
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
    expect(verifyAdminPassword).not.toHaveBeenCalled()
  })
})
