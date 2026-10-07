/** The public readiness route must not let request parameters force recomputation. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCachedPublishedAgentReadiness: vi.fn() }))

vi.mock('@/lib/agent-readiness', () => ({
  getCachedPublishedAgentReadiness: mocks.getCachedPublishedAgentReadiness,
}))

import { GET } from '@/app/api/agent-readiness/route'

const REPORT = { version: 2, score: 91, grade: 'A', totalPages: 3, subscores: [] }

describe('GET /api/agent-readiness', () => {
  beforeEach(() => {
    mocks.getCachedPublishedAgentReadiness.mockReset()
    mocks.getCachedPublishedAgentReadiness.mockResolvedValue({ report: REPORT, asOf: '2026-10-01T00:00:00.000Z' })
  })

  it('serves the memoized v2 report with shared-cache headers', async () => {
    const response = await GET(new Request('https://docs.example.com/api/agent-readiness'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('s-maxage=300')
    expect(await response.json()).toEqual({ schema_version: '2', as_of: '2026-10-01T00:00:00.000Z', ...REPORT })
  })

  it('redirects any query string to the canonical path without computing', async () => {
    const response = await GET(new Request('https://docs.example.com/api/agent-readiness?bust=123&x=y'))
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/api/agent-readiness')
    expect(mocks.getCachedPublishedAgentReadiness).not.toHaveBeenCalled()
  })
})
