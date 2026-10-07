/**
 * The remote MCP endpoint driven by the official SDK client
 * (`@modelcontextprotocol/sdk`), exactly as a real client would: the
 * initialize/session/version handshake, and validation of every
 * `structuredContent` against its tool's `outputSchema`.
 *
 * Source-only (see `.github/scripts/starter-runtime-contract.mjs`): the SDK is
 * a dependency of `packages/mcp`, which standalone starter sites do not have.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const state = vi.hoisted(() => ({
  mcpEnabled: true,
  counters: new Map<string, number>(),
  failStorage: false,
}))

vi.mock('@/data/docs', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).docsModule)
vi.mock('@/lib/content/document', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).contentDocumentModule)
vi.mock('@/lib/i18n/request', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).i18nRequestModule)
vi.mock('@/lib/i18n/translation-source', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).translationSourceModule)
vi.mock('@/config/api-reference', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).apiReferenceConfigModule)
vi.mock('@/lib/openapi/fetch', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).openApiFetchModule)
vi.mock('@/lib/site-config', async () => (await import('@/lib/mcp/__tests__/agent-surface-fixture')).siteConfigModule)
vi.mock('@/lib/admin/settings', () => ({ getAdminSettings: async () => ({ mcpEnabled: state.mcpEnabled }) }))
vi.mock('@/lib/agent-readiness', () => ({
  computePublishedAgentReadiness: async () => ({
    score: 87,
    grade: 'B',
    totalPages: 3,
    subscores: [
      { id: 'x', label: 'Descriptions', score: 0.9, weight: 0.5, detail: 'Most pages have one.' },
      { id: 'y', label: 'API reference', score: 1, weight: 0.1, detail: 'No API spec.', status: 'skip' },
    ],
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    kvIncrement: async (namespace: string, key: string, options?: { amount?: number }) => {
      if (state.failStorage) throw new Error('storage down')
      const id = `${namespace}:${key}`
      const count = (state.counters.get(id) ?? 0) + (options?.amount ?? 1)
      state.counters.set(id, count)
      return { count }
    },
  }),
}))

import { GET, POST } from './route'
import { resetSearchEngine } from '@/lib/search/engine'

const ENDPOINT = 'https://docs.acme.test/api/mcp'

beforeEach(() => {
  state.mcpEnabled = true
  state.failStorage = false
  state.counters.clear()
  resetSearchEngine()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('official SDK client', () => {
  async function connect() {
    const client = new Client({ name: 'route-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      // Route by method as Next would: GET (SSE stream) gets the real 405, and
      // DELETE (session end) is unimplemented, which Next also answers with 405.
      fetch: async (url, init) => {
        const request = new NextRequest(String(url), { ...init, signal: init?.signal ?? undefined } as ConstructorParameters<typeof NextRequest>[1])
        if (request.method === 'POST') return POST(request)
        if (request.method === 'GET') return GET(request)
        return new Response(null, { status: 405 })
      },
    })
    await client.connect(transport)
    return client
  }

  it('connects, lists tools and validates every structured result against its outputSchema', async () => {
    const client = await connect()
    expect(client.getServerVersion()?.name).toBe('acme-docs-docs')
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(8)
    const calls: Array<[string, Record<string, unknown>]> = [
      ['search_docs', { query: 'api key' }],
      ['search_sections', { query: 'webhook' }],
      ['read_page', { pageId: 'guides/auth' }],
      ['list_pages', {}],
      ['list_api_operations', {}],
      ['get_api_operation', { operationId: 'default/users/post' }],
      ['list_changes', { limit: 2 }],
      ['agent_readiness', {}],
    ]
    for (const [name, args] of calls) {
      // callTool throws when structuredContent violates the tool's outputSchema.
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, name).toBe(false)
      expect(result.structuredContent, name).toBeTruthy()
    }
    await client.close()
  })

  it('reads resources through the SDK', async () => {
    const client = await connect()
    const { resources } = await client.listResources()
    const read = await client.readResource({ uri: resources[0].uri })
    expect(read.contents[0].mimeType).toBe('text/markdown')
    await client.close()
  })
})
