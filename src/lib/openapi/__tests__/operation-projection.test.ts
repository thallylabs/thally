/** Agent-facing operation projection: bounded schemas and no configured credentials. */

import { describe, expect, it } from 'vitest'
import { apiOperationMarkdown, compactSchema, describeApiOperation } from '@/lib/openapi/operation-projection'
import type { NormalizedOperation } from '@/lib/openapi/types'

const SECRET = 'sk_live_never_echo'

function operation(overrides: Partial<NormalizedOperation> = {}): NormalizedOperation {
  return {
    specId: 'default',
    id: 'op',
    key: 'GET /items/{id}',
    slug: ['items', 'get'],
    title: 'Get item',
    description: 'Fetch one item.',
    method: 'GET',
    path: '/items/{id}',
    isWebhook: false,
    group: 'Items',
    tags: ['Items'],
    servers: [{ url: 'https://api.example.test/' }],
    parameters: {
      path: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      query: [],
      header: [{ name: 'X-Api-Key', in: 'header', required: false, schema: { type: 'string' } }],
      cookie: [],
    },
    responses: [{ code: '200', description: 'OK', contents: [{ mediaType: 'application/json', schema: { type: 'object', properties: { id: { type: 'string' } } }, examples: [] }] }],
    security: [[{ name: 'key', scopes: [] }], []],
    authSchemes: [{ name: 'key', kind: 'apiKey', in: 'header', paramName: 'X-Api-Key', prefill: SECRET }],
    prefill: { path: { id: '123' }, query: {}, header: { 'X-Api-Key': SECRET }, cookie: {} },
    ...overrides,
  }
}

const node = (op: NormalizedOperation) => ({ operation: op, slug: ['default', ...op.slug!], href: `/api/default/${op.slug!.join('/')}` })

describe('describeApiOperation', () => {
  it('never reads configured credential prefills', () => {
    const detail = describeApiOperation(node(operation()), 'https://docs.example.test')
    expect(JSON.stringify(detail)).not.toContain(SECRET)
    expect(detail.example.curl).toContain("--header 'X-Api-Key: <api-key>'")
    expect(detail.example.curl).toContain("--url 'https://api.example.test/items/{id}'")
  })

  it('treats an empty security alternative as optional auth', () => {
    expect(describeApiOperation(node(operation()), 'https://d.test').auth.required).toBe(false)
    expect(describeApiOperation(node(operation({ security: [[{ name: 'key', scopes: [] }]] })), 'https://d.test').auth.required).toBe(true)
  })

  it('renders compact Markdown', () => {
    const markdown = apiOperationMarkdown(describeApiOperation(node(operation()), 'https://d.test'))
    expect(markdown).toContain('## GET /items/{id} — Get item')
    expect(markdown).toContain('- `id` (path, string, required)')
    expect(markdown).toContain('Auth: apiKey (header `X-Api-Key`) (optional)')
  })
})

describe('compactSchema', () => {
  it('bounds a shared-subtree DAG that would explode when serialized naively', () => {
    // 20 levels, each referencing the next twice: 2^20 paths if expanded.
    let schema: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 20; i += 1) schema = { type: 'object', properties: { left: schema, right: schema } }
    const compact = compactSchema(schema)!
    expect(JSON.stringify(compact).length).toBeLessThan(100_000)
    expect(JSON.stringify(compact)).toContain('[truncated]')
  })

  it('keeps useful keywords and drops vendor extensions', () => {
    expect(compactSchema({ type: 'string', enum: ['a', 'b'], 'x-internal': true, description: 'd' }))
      .toEqual({ type: 'string', description: 'd', enum: ['a', 'b'] })
  })
})
