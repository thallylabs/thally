/** Route coverage for configured and built-in OpenAPI projections. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { parse as parseYaml } from 'yaml'

const mocks = vi.hoisted(() => ({
  specs: [] as Array<Record<string, unknown>>,
  loadSpecDocument: vi.fn(),
  resolveSiteConfig: vi.fn(),
  resolveDocumentationAccessMode: vi.fn(),
}))

vi.mock('@/config/api-reference', () => ({
  apiReferenceConfig: {
    defaultSpecId: 'default',
    specs: mocks.specs,
  },
}))

vi.mock('@/lib/openapi/fetch', () => ({
  getSpecConfig: () => mocks.specs[0],
  loadSpecDocument: mocks.loadSpecDocument,
}))

vi.mock('@/lib/site-config', () => ({
  resolveSiteConfig: mocks.resolveSiteConfig,
}))

vi.mock('@/lib/openapi/documentation-access', () => ({
  resolveDocumentationAccessMode: mocks.resolveDocumentationAccessMode,
}))

import { GET as getJson } from '@/app/openapi.json/route'
import { GET as getYaml } from '@/app/openapi.yaml/route'

describe('public OpenAPI routes', () => {
  beforeEach(() => {
    mocks.specs.splice(0)
    mocks.loadSpecDocument.mockReset()
    mocks.resolveSiteConfig.mockReset()
    mocks.resolveSiteConfig.mockResolvedValue({ name: 'Example Docs' })
    mocks.resolveDocumentationAccessMode.mockReset().mockResolvedValue('public')
  })

  it('publishes the enforced cookie requirement for password-protected sites', async () => {
    mocks.resolveDocumentationAccessMode.mockResolvedValue('password')

    const response = await getJson(
      new NextRequest('https://private.example.com/openapi.json'),
    )
    const document = await response.json()

    expect(document.security).toEqual([{ docsAccess: [] }])
    expect(document.components.securitySchemes.docsAccess).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'thally_docs_access',
    })
    expect(document.paths['/api/docs/{page_id}'].get.responses['401']).toBeDefined()
  })

  it('serves the built-in site API as JSON when no customer spec exists', async () => {
    const response = await getJson(
      new NextRequest('https://docs.example.com/openapi.json'),
    )
    const document = await response.json()

    expect(response.status).toBe(200)
    expect(document.openapi).toBe('3.1.1')
    expect(document.servers).toEqual([{ url: 'https://docs.example.com' }])
    expect(document.security).toEqual([])
    expect(document.paths['/api/search']).toBeDefined()
  })

  it('serves the same built-in contract as valid YAML', async () => {
    const response = await getYaml(
      new NextRequest('https://docs.example.com/openapi.yaml'),
    )
    const document = parseYaml(await response.text())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/yaml; charset=utf-8',
    )
    expect(document.openapi).toBe('3.1.1')
    expect(document.paths['/api/docs-index']).toBeDefined()
  })

  it('returns Problem Details when a configured spec cannot be loaded', async () => {
    mocks.specs.push({ id: 'default' })
    mocks.loadSpecDocument.mockRejectedValue(new Error('private source detail'))

    const response = await getJson(
      new NextRequest('https://docs.example.com/openapi.json'),
    )
    const problem = await response.json()

    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    )
    expect(problem).toMatchObject({
      code: 'openapi_unavailable',
      status: 502,
      instance: '/openapi.json',
    })
    expect(JSON.stringify(problem)).not.toContain('private source detail')
  })
})
