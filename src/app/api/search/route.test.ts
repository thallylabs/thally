/** Machine-actionable validation coverage for public documentation search. */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/search/engine', () => ({ searchDocs: vi.fn() }))
vi.mock('@/lib/cloud-bridge', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/traffic-classifier', () => ({ classifyRequest: vi.fn() }))

import { GET } from './route'

describe('GET /api/search', () => {
  it('explains how to repair a missing query', async () => {
    const response = await GET(
      new NextRequest('https://docs.example.com/api/search'),
    )
    const problem = await response.json()

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    )
    expect(problem).toMatchObject({
      code: 'missing_query',
      status: 400,
      instance: '/api/search',
    })
    expect(problem.resolution).toContain('/api/search?q=authentication')
  })
})
