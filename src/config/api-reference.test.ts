/** Regression coverage for the public OpenAPI specification link. */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('@/data/docs')
  vi.resetModules()
})

async function loadSpecUrl(source?: string) {
  vi.doMock('@/data/docs', () => ({
    tabCollectionId: (tab: string) => tab,
    getSidebarCollections: () => source ? [{ api: { source } }] : [],
  }))
  const { getOpenApiSpecUrl } = await import('@/config/api-reference')
  return getOpenApiSpecUrl('https://docs.example.com/workspace')
}

describe('public OpenAPI specification URL', () => {
  it.each([
    ['a nested repository file', 'openapi/product.yaml'],
    ['a root repository file', 'openapi.yaml'],
    ['a remote source', 'https://specs.example.com/product.json'],
  ])('links %s through the served YAML projection', async (_label, source) => {
    await expect(loadSpecUrl(source)).resolves.toBe(
      'https://docs.example.com/openapi.yaml',
    )
  })

  it('omits the link when no specification is configured', async () => {
    await expect(loadSpecUrl()).resolves.toBeNull()
  })
})

describe('spec URL for a specific spec', () => {
  it('is only advertised for the spec that /openapi.yaml serves', async () => {
    vi.doMock('@/data/docs', () => ({
      tabCollectionId: (tab: string) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      getSidebarCollections: () => [
        { id: 'rest', label: 'REST', api: { source: 'openapi.json' } },
        { id: 'admin', label: 'Admin', api: { source: 'openapi/admin.json' } },
      ],
    }))
    const { getOpenApiSpecUrl } = await import('@/config/api-reference')
    expect(getOpenApiSpecUrl('https://docs.example.com', 'default')).toBe('https://docs.example.com/openapi.yaml')
    expect(getOpenApiSpecUrl('https://docs.example.com', 'admin')).toBeNull()
  })
})

describe('multiple API-bound tabs', () => {
  afterEach(() => {
    vi.doUnmock('@/data/docs')
    vi.resetModules()
  })

  it('builds one spec per api-bound tab, keyed by the tab id after the first', async () => {
    vi.doMock('@/data/docs', () => ({
      tabCollectionId: (tab: string) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      getSidebarCollections: () => [
        { id: 'rest-api', label: 'REST API', api: { source: 'openapi.json' } },
        { id: 'ws-api', label: 'WebSocket API', api: { source: 'asyncapi.yaml' } },
        { id: 'guides', label: 'Guides' },
      ],
    }))
    const { apiReferenceConfig } = await import('@/config/api-reference')
    expect(apiReferenceConfig.specs.map((spec) => spec.id)).toEqual(['default', 'ws-api'])
    expect(apiReferenceConfig.specs[1].label).toBe('WebSocket API')
    expect(apiReferenceConfig.defaultSpecId).toBe('default')
  })
})

describe('specs bound to hidden tabs', () => {
  it('key a hidden tab by the same collection id the sidebar assigns', async () => {
    vi.doMock('@/data/docs', () => ({
      getSidebarCollections: () => [{ id: 'rest-api', label: 'REST API', api: { source: 'openapi.json' } }],
      tabCollectionId: (tab: string) => `shared-${tab.length}`,
    }))
    vi.doMock('@/lib/docs-json-config', () => ({
      getDocsJsonConfig: () => ({ tabs: [{ tab: 'Hidden Spec', hidden: true, api: { source: 'openapi/h.json' } }] }),
    }))
    const { apiReferenceConfig } = await import('@/config/api-reference')
    expect(apiReferenceConfig.specs.map((spec) => spec.id)).toEqual(['default', 'shared-11'])
    vi.doUnmock('@/lib/docs-json-config')
  })

  it('registers them after every visible spec, so page frontmatter can name them', async () => {
    vi.doMock('@/data/docs', () => ({
      tabCollectionId: (tab: string) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      getSidebarCollections: () => [
        { id: 'guides', label: 'Guides' },
        { id: 'rest-api', label: 'REST API', api: { source: 'openapi.json' } },
      ],
    }))
    vi.doMock('@/lib/docs-json-config', () => ({
      getDocsJsonConfig: () => ({
        tabs: [
          { tab: 'OpenAPI: v2.json', hidden: true, api: { source: 'openapi/v2.json', navigation: false } },
          { tab: 'REST API', api: { source: 'openapi.json' } },
        ],
      }),
    }))
    const { apiReferenceConfig } = await import('@/config/api-reference')
    expect(apiReferenceConfig.specs.map((spec) => [spec.id, spec.source])).toEqual([
      ['default', { type: 'file', path: 'openapi.json' }],
      ['openapi-v2-json', { type: 'file', path: 'openapi/v2.json' }],
    ])
    expect(apiReferenceConfig.specs.map((spec) => spec.pageOnly)).toEqual([undefined, true])
    vi.doUnmock('@/lib/docs-json-config')
  })
})
