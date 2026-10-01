/**
 * The Try It relay and the page lookups call `getApiOperationByKey` on every
 * request, which used to re-normalize the whole spec each time. The result is
 * kept per spec and dropped when the raw spec cache hands out a new document.
 */

import { describe, expect, it, vi } from 'vitest'

const ok = { responses: { 200: { description: 'ok' } } }
const state = vi.hoisted(() => ({
  documents: {} as Record<string, unknown>,
  normalize: vi.fn(),
}))

vi.mock('@/config/api-reference', () => ({
  apiReferenceConfig: {
    defaultSpecId: 'default',
    specs: [
      { id: 'default', label: 'API', source: { type: 'inline', document: {} } },
      { id: 'admin', label: 'Admin', source: { type: 'inline', document: {} } },
    ],
  },
}))
vi.mock('@/lib/openapi/fetch', () => ({
  getSpecConfig: (config: { specs: Array<{ id: string }> }, id: string) => config.specs.find((spec) => spec.id === id),
  loadSpec: async (config: { id: string }) => ({ config, document: state.documents[config.id] }),
}))
vi.mock('@/lib/openapi/normalize', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/openapi/normalize')>()
  return { ...actual, normalizeSpec: (...args: Parameters<typeof actual.normalizeSpec>) => { state.normalize(); return actual.normalizeSpec(...args) } }
})

import { getApiOperationByKey, getApiOperationNodes, servedSpecPathForFrontmatter } from '@/data/api-reference'
import { parseOpenApiFrontmatter } from '@/lib/openapi/page-frontmatter'

const doc = (path: string) => ({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { [path]: { get: ok } } })

describe('normalized spec cache', () => {
  it('normalizes a spec once across calls and again after its document changes', async () => {
    state.documents = { default: doc('/a'), admin: doc('/b') }
    await getApiOperationByKey('GET', '/a', 'default')
    await getApiOperationByKey('GET', '/a', 'default')
    await getApiOperationNodes('default')
    await servedSpecPathForFrontmatter(parseOpenApiFrontmatter('GET /a')!)
    expect(state.normalize).toHaveBeenCalledTimes(1)

    await getApiOperationNodes('admin')
    await getApiOperationNodes('admin')
    expect(state.normalize).toHaveBeenCalledTimes(2)

    // The raw cache returned a new document (spec updated): the old normalization must not be served.
    state.documents.default = doc('/changed')
    expect(await getApiOperationByKey('GET', '/a', 'default')).toBeNull()
    expect(await getApiOperationByKey('GET', '/changed', 'default')).not.toBeNull()
    expect(state.normalize).toHaveBeenCalledTimes(3)
  })
})
