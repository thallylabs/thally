import { describe, expect, it } from 'vitest'
import { findSpecForRef, parseOpenApiFrontmatter } from '@/lib/openapi/page-frontmatter'
import type { ApiSpecConfig } from '@/lib/openapi/types'

describe('parseOpenApiFrontmatter', () => {
  it('keeps the legacy bare form', () => {
    expect(parseOpenApiFrontmatter('POST /things')).toEqual({ specId: 'default', method: 'POST', path: '/things' })
    expect(parseOpenApiFrontmatter('  get   /users/{id}  ')).toEqual({ specId: 'default', method: 'GET', path: '/users/{id}' })
    expect(parseOpenApiFrontmatter('\tGET\t/x')).toMatchObject({ method: 'GET', path: '/x' })
  })

  it('parses spec-prefixed values, quoted and with a leading slash', () => {
    expect(parseOpenApiFrontmatter('openapi-b.yaml GET /widgets/{id}')).toMatchObject({ specRef: 'openapi-b.yaml', method: 'GET', path: '/widgets/{id}' })
    expect(parseOpenApiFrontmatter('/path/to/spec.yaml GET /x')).toMatchObject({ specRef: '/path/to/spec.yaml' })
    expect(parseOpenApiFrontmatter('"my spec.json" post /x')).toMatchObject({ specRef: 'my spec.json', method: 'POST' })
    expect(parseOpenApiFrontmatter('my spec.json GET /x')).toMatchObject({ specRef: 'my spec.json' })
    expect(parseOpenApiFrontmatter('"openapi.json GET /x"')).toMatchObject({ specRef: 'openapi.json', path: '/x' })
    expect(parseOpenApiFrontmatter('https://example.com/spec.json GET /x')).toMatchObject({ specRef: 'https://example.com/spec.json' })
  })

  it('parses the webhook form', () => {
    expect(parseOpenApiFrontmatter('openapi.json webhook orderUpdated')).toEqual({ specId: 'default', specRef: 'openapi.json', method: 'WEBHOOK', path: 'orderUpdated', webhook: true })
    expect(parseOpenApiFrontmatter('webhook orderUpdated')).toMatchObject({ webhook: true, path: 'orderUpdated' })
  })

  it('rejects malformed and non-string values', () => {
    for (const value of ['', '   ', 'GET', 'GET users', '/users', 123, ['GET /x'], { a: 1 }, null, undefined]) {
      expect(parseOpenApiFrontmatter(value)).toBeNull()
    }
  })

  it('passes unknown methods through so the lookup misses like before', () => {
    expect(parseOpenApiFrontmatter('FETCH /x')).toMatchObject({ method: 'FETCH' })
  })
})

describe('findSpecForRef', () => {
  const specs: Array<ApiSpecConfig> = [
    { id: 'default', label: 'A', source: { type: 'file', path: '/openapi-a.json' } },
    { id: 'b', label: 'B', source: { type: 'file', path: 'specs/openapi-b.yaml' } },
    { id: 'c', label: 'C', source: { type: 'url', url: 'https://example.com/v1/api.json' } },
    { id: 'd', label: 'D', source: { type: 'inline', document: {} } },
  ]

  it('matches by path, file name, leading slash, ./ and case', () => {
    expect(findSpecForRef(specs, 'openapi-a.json')?.id).toBe('default')
    expect(findSpecForRef(specs, './specs/openapi-b.yaml')?.id).toBe('b')
    expect(findSpecForRef(specs, '/openapi-b.yaml')?.id).toBe('b')
    expect(findSpecForRef(specs, 'OpenAPI-A.JSON')?.id).toBe('default')
    expect(findSpecForRef(specs, 'https://example.com/v1/api.json')?.id).toBe('c')
    expect(findSpecForRef(specs, 'api.json')?.id).toBe('c')
  })

  it('returns null for unknown specs', () => {
    expect(findSpecForRef(specs, 'nope.json')).toBeNull()
    expect(findSpecForRef(specs, '')).toBeNull()
    expect(findSpecForRef([], 'openapi-a.json')).toBeNull()
  })

  it('prefers a full path match over a file name match, then the first configured', () => {
    const dup: Array<ApiSpecConfig> = [
      { id: 'one', label: '1', source: { type: 'file', path: 'a/openapi.json' } },
      { id: 'two', label: '2', source: { type: 'file', path: 'b/openapi.json' } },
    ]
    expect(findSpecForRef(dup, 'b/openapi.json')?.id).toBe('two')
    expect(findSpecForRef(dup, 'openapi.json')?.id).toBe('one')
  })
})
