/** Remote repository OpenAPI hydration preserves routes without trusting source URLs. */
import { describe, expect, it, vi } from 'vitest'

import { hydrateRemoteApiSpecs } from '../remote-api.js'
import type { MigrationBundle, MigrationFetcher } from '../types.js'

const SPEC_URL = 'https://specs.example.com/openapi.json'

function bundle(source = SPEC_URL): MigrationBundle {
  return {
    sourceUrl: 'https://github.com/example/docs',
    sourceKind: 'repository',
    platform: 'mintlify',
    pages: [{
      id: 'guide', navigationId: 'guide', title: 'Guide', description: '', keywords: [],
      body: '[List users](/api-reference/scim/list-users)', source: 'guide.mdx',
    }],
    assets: [],
    remoteApiSpecs: [{ url: source, tabLabel: 'API' }],
    docsConfig: { tabs: [{ tab: 'API', groups: [{ group: 'Overview', pages: ['guide'] }] }] },
    warnings: [{ code: 'unsupported-config', source, message: `The remote OpenAPI spec "${source}" requires a network download before this import is complete.` }],
    stats: { discovered: 1, imported: 1, skipped: 0 },
  }
}

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Example', version: '1' },
  paths: { '/api/v1/scim/v2/Users': { get: { summary: 'List users', tags: ['SCIM'], responses: { 200: { description: 'OK' } } } } },
})

describe('remote OpenAPI hydration', () => {
  it('downloads a configured spec, enables generated navigation, and redirects known source links', async () => {
    const fetcher: MigrationFetcher = vi.fn(async (url) => ({ finalUrl: url, body: spec, contentType: 'application/json' }))
    const result = await hydrateRemoteApiSpecs(bundle(), fetcher)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0].path).toMatch(/^openapi\/openapi-[0-9a-f]{12}\.json$/)
    expect(result.assets[0].projectRelative).toBe(true)
    expect(result.docsConfig.tabs[0].api).toEqual({ source: result.assets[0].path })
    expect(result.docsConfig.redirects).toContainEqual({
      source: '/api-reference/scim/list-users',
      destination: '/api/default/api/v1/scim/v2/users/get',
      permanent: false,
    })
    expect(result.warnings).toEqual([])
  })

  it('keeps a visible failure when an insecure or private host is configured', async () => {
    const fetcher: MigrationFetcher = vi.fn(async (url) => ({ finalUrl: url, body: spec, contentType: 'application/json' }))
    for (const source of ['http://specs.example.com/openapi.json', 'https://127.0.0.1/openapi.json']) {
      const result = await hydrateRemoteApiSpecs(bundle(source), fetcher)
      expect(result.assets).toEqual([])
      expect(result.warnings.some((warning) => warning.code === 'fetch-failed')).toBe(true)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not guess a redirect when operation labels collide', async () => {
    const duplicate = JSON.stringify({
      openapi: '3.0.0', info: { title: 'Example', version: '1' },
      paths: {
        '/users': { get: { summary: 'List users', tags: ['SCIM'] } },
        '/accounts': { get: { summary: 'List users', tags: ['SCIM'] } },
      },
    })
    const result = await hydrateRemoteApiSpecs(bundle(), async (url) => ({ finalUrl: url, body: duplicate, contentType: 'application/json' }))
    expect(result.assets).toHaveLength(1)
    expect(result.docsConfig.redirects).toBeUndefined()
  })
})
