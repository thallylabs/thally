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
