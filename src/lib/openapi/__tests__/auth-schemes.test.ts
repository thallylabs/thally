import { describe, expect, it, vi } from 'vitest'
import { normalizeSpec } from '@/lib/openapi/normalize'
import type { ApiSpecConfig, ResolvedSpec } from '@/lib/openapi/types'

let credentials: Record<string, string> = {}
vi.mock('@/data/docs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/docs')>()),
  getApiPlaygroundCredentials: () => credentials,
}))

const operationFor = (securitySchemes: Record<string, unknown>, security: unknown, extra: Record<string, unknown> = {}) => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    components: { securitySchemes },
    paths: { '/x': { get: { responses: {}, security, ...extra } } },
  }
  const config: ApiSpecConfig = { id: 't', label: 'T', source: { type: 'inline', document } }
  return normalizeSpec({ config, document } as ResolvedSpec).operations[0]
}

describe('authSchemes from securitySchemes', () => {
  it('describes bearer, basic and apiKey schemes by where the credential goes', () => {
    const op = operationFor(
      {
        b: { type: 'http', scheme: 'bearer', description: 'Your key' },
        c: { type: 'http', scheme: 'basic' },
        h: { type: 'apiKey', in: 'header', name: 'X-Key' },
        q: { type: 'apiKey', in: 'query', name: 'key' },
        k: { type: 'apiKey', in: 'cookie', name: 'sid' },
      },
      [{ b: [] }, { c: [] }, { h: [] }, { q: [] }, { k: [] }],
    )
    expect(op.authSchemes.map(({ name, kind, in: where, paramName }) => ({ name, kind, where, paramName }))).toEqual([
      { name: 'b', kind: 'bearer', where: 'header', paramName: 'Authorization' },
      { name: 'c', kind: 'basic', where: 'header', paramName: 'Authorization' },
      { name: 'h', kind: 'apiKey', where: 'header', paramName: 'X-Key' },
      { name: 'q', kind: 'apiKey', where: 'query', paramName: 'key' },
      { name: 'k', kind: 'apiKey', where: 'cookie', paramName: 'sid' },
    ])
    expect(op.authSchemes[0].description).toBe('Your key')
  })

  it('never prefills a placeholder credential', () => {
    credentials = {}
    const op = operationFor({ b: { type: 'http', scheme: 'bearer' } }, [{ b: [] }])
    expect(op.prefill.header).toEqual({})
    expect(op.authSchemes[0].prefill).toBeUndefined()
  })

  it('keeps the site-wide apiPlayground.credentials prefill', () => {
    credentials = { b: 'Bearer abc' }
    const op = operationFor({ b: { type: 'http', scheme: 'bearer' } }, [{ b: [] }])
    expect(op.authSchemes[0].prefill).toBe('abc')
    credentials = {}
  })
})
