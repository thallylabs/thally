/** Endpoint pages apply the docs.json title separator like prose pages. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(docs)/[[...slug]]/page', () => ({ default: vi.fn(), generateMetadata: vi.fn() }))
vi.mock('@/data/api-reference', () => ({
  getApiOperationBySlug: vi.fn(async () => ({
    href: '/api/default/analytics/query/post',
    operation: { title: 'Query analytics data', method: 'POST', path: '/analytics/query', specId: 'default' },
  })),
  getAllApiOperationNodes: vi.fn(async () => []),
  getApiOperationNodes: vi.fn(async () => []),
}))
vi.mock('@/data/docs', () => ({
  getApiPlaygroundDisplay: () => undefined,
  getBreadcrumbs: () => [],
  getDocEntries: () => [],
  loadDocEntries: async () => [],
  getSeoConfig: () => ({ titleSeparator: ' - ' }),
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default' }, getOpenApiSpecUrl: () => null }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'OpenRouter' }) }))

import { generateMetadata } from './page'

describe('API endpoint metadata', () => {
  it('uses the configured title separator for the full title', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: ['default', 'analytics', 'query', 'post'] }) })
    expect(metadata.title).toEqual({ absolute: 'Query analytics data - OpenRouter' })
  })
})
