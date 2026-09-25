/** Regression coverage for the public OpenAPI specification link. */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('@/data/docs')
  vi.resetModules()
})

async function loadSpecUrl(source?: string) {
  vi.doMock('@/data/docs', () => ({
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

describe('multiple API-bound tabs', () => {
  afterEach(() => {
    vi.doUnmock('@/data/docs')
    vi.resetModules()
  })

  it('builds one spec per api-bound tab, keyed by the tab id after the first', async () => {
    vi.doMock('@/data/docs', () => ({
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
