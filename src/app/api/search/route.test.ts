/** Machine-actionable validation coverage for public documentation search. */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  searchDocs: vi.fn(),
  providerId: 'local-hash-v3',
  counters: new Map<string, number>(),
  failStorage: false,
}))

vi.mock('@/lib/search/engine', () => ({ searchDocs: mocks.searchDocs }))
vi.mock('@thallylabs/core/embeddings', () => ({
  getEmbeddingProvider: () => ({ id: mocks.providerId }),
  localHashProvider: { id: 'local-hash-v3' },
}))
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    kvIncrement: async (namespace: string, key: string, options?: { amount?: number }) => {
      if (mocks.failStorage) throw new Error('storage down')
      const id = `${namespace}:${key}`
      const count = (mocks.counters.get(id) ?? 0) + (options?.amount ?? 1)
      mocks.counters.set(id, count)
      return { count }
    },
  }),
}))
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
      mode: 'fulltext',
      locale: 'fr',
    })
  })

  it('defaults anonymous queries to full-text and honors an explicit local hybrid request', async () => {
    mocks.searchDocs.mockResolvedValue([])
    mocks.providerId = 'local-hash-v3'
    expect((await (await GET(new NextRequest('https://docs.example.com/api/search?q=a'))).json()).mode).toBe('fulltext')
    expect((await (await GET(new NextRequest('https://docs.example.com/api/search?q=a&mode=hybrid'))).json()).mode).toBe('hybrid')
  })

  it('meters hosted-embedding hybrid queries per client and degrades to full-text over the limit', async () => {
    mocks.searchDocs.mockResolvedValue([])
    mocks.providerId = 'openai:text-embedding-3-small'
    mocks.counters.clear()
    const request = (forwarded: string) => new NextRequest('https://docs.example.com/api/search?q=a&mode=hybrid', {
      headers: { 'x-forwarded-for': forwarded },
    })
    for (let i = 0; i < 20; i += 1) {
      // A forged leftmost hop must not mint a fresh bucket.
      expect((await (await GET(request(`10.0.0.${i}, 198.51.100.9`))).json()).mode).toBe('hybrid')
    }
    const degraded = await GET(request('10.9.9.9, 198.51.100.9'))
    expect(degraded.headers.get('cache-control')).toBe('no-store')
    expect(await degraded.json()).toMatchObject({ mode: 'fulltext', mode_requested: 'hybrid', mode_degraded_reason: 'rate_limited' })

    mocks.failStorage = true
    mocks.counters.clear()
    expect((await (await GET(request('198.51.100.10'))).json()).mode).toBe('fulltext')
    mocks.failStorage = false
    mocks.providerId = 'local-hash-v3'
  })

  it('returns typed results with section links and API operation fields', async () => {
    mocks.searchDocs.mockResolvedValueOnce([
      { type: 'page', pageId: 'guides/auth', title: 'Auth', description: '', href: '/guides/auth', score: 2, snippet: 's', anchor: 'api-keys', heading: 'API keys' },
      { type: 'api_operation', pageId: 'default/users/post', title: 'Create user', description: '', href: '/api/default/users/post', score: 1, snippet: '', method: 'POST', path: '/users' },
    ])
    const body = await (await GET(new NextRequest('https://docs.example.com/api/search?q=user'))).json()
    expect(body.results[0]).toMatchObject({
      type: 'page',
      section_url: 'https://docs.example.com/guides/auth#api-keys',
      api_url: 'https://docs.example.com/api/docs/guides/auth',
    })
    expect(body.results[1]).toMatchObject({ type: 'api_operation', method: 'POST', path: '/users' })
    expect(body.results[1].api_url).toBeUndefined()
  })
})
