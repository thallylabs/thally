/**
 * A page bound to a hidden or excluded operation 404s, so every listing must
 * omit it through the one shared predicate; unknown operations are untouched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ok = { responses: { 200: { description: 'ok' } } }
const spec = vi.hoisted(() => ({
  document: {} as unknown,
}))

const config = vi.hoisted(() => ({
  tabs: [
    {
      tab: 'Docs',
      groups: [{ group: 'Guides', pages: ['a', 'hidden-endpoint', 'b', 'excluded-endpoint', 'typo-endpoint', 'shown-endpoint', 'c'] }],
      api: { source: 'openapi/x.json', overrides: { 'GET /unhidden': { hidden: false } } },
    },
  ],
}))
const frontmatter: Record<string, string> = {
  'hidden-endpoint': 'openapi: "GET /hidden"',
  'excluded-endpoint': 'openapi: "GET /excluded"',
  'typo-endpoint': 'openapi: "GET /no-such-path"',
  'shown-endpoint': 'openapi: "GET /shown"',
}

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => config,
  getDocsJsonConfigRevision: () => 1,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => ['a', 'hidden-endpoint', 'b', 'excluded-endpoint', 'typo-endpoint', 'shown-endpoint', 'c'].map((id) => `src/content/${id}.mdx`),
  readRuntimeSource: (path: string) => {
    const id = path.replace('src/content/', '').replace('.mdx', '')
    return `---\ntitle: ${id}\n${frontmatter[id] ?? ''}\n---\nBody`
  },
  runtimeSourceExists: () => true,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null }))
vi.mock('@/config/api-reference', () => ({
  apiReferenceConfig: { defaultSpecId: 'default', specs: [{ id: 'default', label: 'API', source: { type: 'inline', document: {} }, operationOverrides: config.tabs[0].api.overrides }] },
}))
vi.mock('@/lib/openapi/fetch', () => ({
  getSpecConfig: (reference: { specs: Array<{ id: string }> }, id: string) => reference.specs.find((entry) => entry.id === id),
  loadRawSpecDocument: async () => spec.document,
  loadSpec: async (entry: unknown) => ({ config: entry, document: spec.document }),
}))

// Fresh modules per test: publication is decided once per process.
const load = async () => {
  vi.resetModules()
  const docs = await import('@/data/docs')
  const publication = await import('@/data/doc-publication')
  return { ...docs, ...publication }
}

const ids = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id)

beforeEach(() => {
  spec.document = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/hidden': { get: { 'x-hidden': true, ...ok } },
      '/excluded': { get: { 'x-excluded': true, ...ok } },
      '/shown': { get: ok },
    },
  }
})

describe('the published-page predicate', () => {
  it('finds pages whose operation is certainly hidden or excluded, and leaves unknown ones alone', async () => {
    const { getDocEntries, findUnpublishedPageIds } = await load()
    const entries = getDocEntries()
    expect((await findUnpublishedPageIds(entries)).sort()).toEqual(['excluded-endpoint', 'hidden-endpoint'])
  })

  it('applies an override that un-hides an operation', async () => {
    const { getDocEntries, findUnpublishedPageIds } = await load()
    ;(spec.document as { paths: Record<string, unknown> }).paths['/unhidden'] = { get: { 'x-hidden': true, ...ok } }
    frontmatter['shown-endpoint'] = 'openapi: "GET /unhidden"'
    try {
      expect(await findUnpublishedPageIds(getDocEntries())).not.toContain('shown-endpoint')
    } finally {
      frontmatter['shown-endpoint'] = 'openapi: "GET /shown"'
    }
  })

  it('does not throw when the spec cannot be judged', async () => {
    const { getDocEntries, findUnpublishedPageIds } = await load()
    spec.document = null
    expect(await findUnpublishedPageIds(getDocEntries())).toEqual([])
  })
})

describe('every listing routes through isDocPublished', () => {
  it('lists everything until publication is decided, then omits the unpublished pages', async () => {
    const { getDocEntries, getNavigablePageIds, isDocPublished, loadDocEntries, primeDocPublication } = await load()
    expect(ids(getDocEntries())).toContain('hidden-endpoint')
    await primeDocPublication()

    expect(isDocPublished('hidden-endpoint')).toBe(false)
    expect(isDocPublished('excluded-endpoint')).toBe(false)
    expect(isDocPublished('typo-endpoint')).toBe(true)
    expect(isDocPublished('shown-endpoint')).toBe(true)

    // enumeration (sitemap, llms.txt, llms-full, docs-index, /api/docs, search, skill.md, MCP)
    expect(ids(getDocEntries())).toEqual(['a', 'b', 'typo-endpoint', 'shown-endpoint', 'c'])
    expect(ids(await loadDocEntries())).toEqual(['a', 'b', 'typo-endpoint', 'shown-endpoint', 'c'])
    expect([...getNavigablePageIds()]).not.toContain('hidden-endpoint')
  })

  it('drops them from navigation, previous/next and breadcrumbs', async () => {
    const { getBreadcrumbs, getPrevNextLinks, getSidebarCollections, loadNavContext, loadSidebarCollections, primeDocPublication } = await load()
    await primeDocPublication()
    const items = (await loadSidebarCollections())[0].sections.flatMap((section) => section.items.map((item) => item.href))
    expect(items).toEqual(['/a', '/b', '/typo-endpoint', '/shown-endpoint', '/c'])
    expect(getSidebarCollections()[0].sections[0].items.map((item) => item.href)).toEqual(items)

    expect(getPrevNextLinks('/b').next?.href).toBe('/typo-endpoint')
    expect(getPrevNextLinks('/typo-endpoint').prev?.href).toBe('/b')
    expect(getBreadcrumbs('/hidden-endpoint')).toEqual([])
    const context = await loadNavContext('typo-endpoint')
    expect(context.prev?.href).toBe('/b')
  })

  it('async loaders decide publication themselves, without a separate prime', async () => {
    const { loadDocEntries } = await load()
    expect(ids(await loadDocEntries())).not.toContain('hidden-endpoint')
    const { loadSidebarCollections } = await load()
    expect((await loadSidebarCollections())[0].sections[0].items.map((item) => item.href)).not.toContain('/hidden-endpoint')
  })
})
