/**
 * The page renderer (get-doc), the page index (docs.ts), the `/api/docs` JSON
 * and agent-readiness must read a page's API frontmatter identically: one
 * fixture, every surface.
 */

import { describe, expect, it, vi } from 'vitest'
import { parseFrontmatter } from '@/lib/frontmatter'
import { docApiJson } from '@/lib/openapi/page-api'

const PAGES: Record<string, string> = {
  prefixed: 'openapi: "openapi/admin.json GET /moved"',
  hook: 'openapi: "admin.json webhook orderUpdated"',
  manual: 'api: "POST https://api.example.com/users"',
  manualPath: 'api: "get /status"',
  both: 'openapi: "GET /a"\napi: "GET /b"',
  badApi: 'api: "FETCH"',
  plain: 'description: plain',
}
const sourceOf = (id: string) => `---\ntitle: T\n${PAGES[id]}\n---\nbody\n`
const sources = () => Object.fromEntries(Object.keys(PAGES).map((id) => [`src/content/${id}.mdx`, sourceOf(id)]))

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => ({ tabs: [{ tab: 'Docs', groups: [{ group: 'G', pages: Object.keys(PAGES) }] }] }),
  getDocsJsonConfigRevision: () => 1,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(sources()),
  readRuntimeSource: (file: string) => sources()[file],
  runtimeSourceExists: (file: string) => file in sources(),
  runtimeSourceModifiedAt: () => 0,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null, isIndexedContentPath: () => false }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default', specs: [] } }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'filesystem',
    exists: async (file: string) => file in sources(),
    read: async (file: string) => (file in sources() ? { content: sources()[file] } : null),
  }),
}))
vi.mock('next-mdx-remote/rsc', () => ({ compileMDX: vi.fn() }))
vi.mock('@/lib/mdx-interpret', () => ({ interpretMDX: vi.fn() }))
vi.mock('@/mdx/remark', () => ({ remarkPlugins: [] }))
vi.mock('@/mdx/rehype', () => ({ rehypePlugins: [] }))
vi.mock('@/components/mdx/mdx-components', () => ({ useMDXComponents: () => ({}) }))
vi.mock('@/mdx/snippet-registry', () => ({ resolveSnippetComponent: vi.fn() }))
vi.mock('@/generated/runtime-docs', () => ({
  runtimeDocs: new Proxy({}, {
    get: (_target, key: string) => (key in sources() ? { component: () => null, frontmatter: parseFrontmatter(sources()[key]).data } : undefined),
  }),
}))
vi.mock('@/lib/content', () => ({ getContentDocument: () => null, loadContentDocument: async () => null }))

import { getDocEntries } from '@/data/docs'
import { getDocFromParams } from '@/data/get-doc'
import { gatherPageFacts } from '@/lib/agent-readiness/gather'

describe('API frontmatter parity between renderer, index, JSON and readiness', () => {
  const ids = Object.keys(PAGES)

  it.each(ids)('%s: the index sees the operation the renderer renders', async (id) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entry = getDocEntries().find((candidate) => candidate.id === id)!
    const doc = (await getDocFromParams([id]))!
    expect(entry.openapi).toEqual(doc.openapi)
    expect(Boolean(entry.manualTarget)).toBe(Boolean(doc.manualApi))
    if (doc.manualApi) expect(entry.manualTarget).toMatchObject({ method: doc.manualApi.method, path: doc.manualApi.path })
    const fact = gatherPageFacts().find((candidate) => candidate.pageId === id)!
    expect(fact.isApi).toBe(Boolean(doc.openapi || doc.manualApi))
    expect(fact.hasOpenApiSpec).toBe(fact.isApi)
  })

  it('exposes spec-prefixed, webhook and manual operations in the JSON docs output', () => {
    const byId = (id: string) => docApiJson(getDocEntries().find((entry) => entry.id === id)!)
    expect(byId('prefixed')).toEqual({ spec_url: '/openapi.yaml', operations: ['GET /moved'] })
    expect(byId('hook')).toEqual({ spec_url: '/openapi.yaml', operations: ['WEBHOOK orderUpdated'] })
    expect(byId('manual')).toEqual({ operations: ['POST /users'] })
    expect(byId('manualPath')).toEqual({ operations: ['GET /status'] })
    expect(byId('both')).toEqual({ spec_url: '/openapi.yaml', operations: ['GET /a'] })
    expect(byId('badApi')).toBeUndefined()
    expect(byId('plain')).toBeUndefined()
  })

  it('classifies these pages as API pages for agent readiness', () => {
    const facts = new Map(gatherPageFacts().map((fact) => [fact.pageId, fact]))
    for (const id of ['prefixed', 'hook', 'manual', 'manualPath', 'both']) expect(facts.get(id)?.isApi, id).toBe(true)
    for (const id of ['badApi', 'plain']) expect(facts.get(id)?.isApi, id).toBe(false)
  })
})
