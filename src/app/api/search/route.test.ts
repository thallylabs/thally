/** Machine-actionable validation coverage for public documentation search. */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ searchDocs: vi.fn() }))

vi.mock('@/lib/search/engine', () => ({ searchDocs: mocks.searchDocs }))
vi.mock('@/lib/cloud-bridge', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/traffic-classifier', () => ({ classifyRequest: vi.fn() }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
  }),
}))

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

  it('accepts a locale enabled through live settings and searches its corpus', async () => {
    mocks.searchDocs.mockResolvedValueOnce([])
    const response = await GET(new NextRequest('https://docs.example.com/api/search?q=guide&locale=fr'))

    expect(response.status).toBe(200)
    expect((await response.json()).locale).toBe('fr')
    expect(mocks.searchDocs).toHaveBeenCalledWith('guide', {
      limit: 8,
      mode: 'hybrid',
      locale: 'fr',
    })
  })
})
