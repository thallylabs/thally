/** Regression: access protection must not redirect the server-side handshake. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/auth-edge', () => ({
  ADMIN_SESSION_COOKIE: 'admin-session',
  DOCS_ACCESS_COOKIE: 'docs-access',
  getInternalAnalyticsSecretEdge: () => 'analytics-secret',
  isAdminAuthenticatedEdge: vi.fn().mockResolvedValue(false),
  isAdminEnabledEdge: vi.fn().mockReturnValue(false),
  isDocsAccessEnabledEdge: vi.fn().mockReturnValue(true),
  isDocsAccessGrantedEdge: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'session',
  verifySession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/traffic-classifier', () => ({
  classifyRequest: vi.fn(),
  isAgentRequest: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/agent-endpoints', () => ({
  isMachineEndpoint: vi.fn().mockReturnValue(false),
  isPublicAgentEndpoint: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: vi.fn().mockResolvedValue(null),
}))

import { middleware } from '@/middleware'

describe('Thally Cloud handshake middleware access', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through without a docs-access cookie', async () => {
    const request = new NextRequest('https://docs.example.com/api/cloud/handshake', {
      method: 'POST',
    })
    const response = await middleware(request, { waitUntil: vi.fn() } as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
