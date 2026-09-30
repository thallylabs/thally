/**
 * A page bound to a hidden or excluded operation 404s, so every listing must
 * omit it through the one shared predicate, from the very first call on a
 * fresh module instance (a cold route) with nothing primed by anyone else.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectRuntimeContentFiles } from '../../scripts/lib/runtime-content-files'

const ok = { responses: { 200: { description: 'ok' } } }
const PAGES = ['a', 'hidden-endpoint', 'b', 'excluded-endpoint', 'typo-endpoint', 'shown-endpoint', 'c']
const frontmatter: Record<string, string> = {
  'hidden-endpoint': 'openapi: "GET /hidden"',
  'excluded-endpoint': 'openapi: "GET /excluded"',
  'typo-endpoint': 'openapi: "GET /no-such-path"',
  'shown-endpoint': 'openapi: "GET /shown"',
}

const state = vi.hoisted(() => ({ sources: {} as Record<string, { content: string }> }))
const config = vi.hoisted(() => ({
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: [] as Array<string> }] }],
}))

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(state.sources),
  readRuntimeSource: (file: string) => state.sources[file].content,
  runtimeSourceExists: (file: string) => file in state.sources,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default', specs: [] } }))

/** What the real build embeds: MDX pages plus the filtered spec copy and the record of what it withheld. */
beforeEach(() => {
  config.tabs[0].groups[0].pages = [...PAGES]
  const root = mkdtempSync(path.join(tmpdir(), 'thally-publication-'))
  mkdirSync(path.join(root, 'openapi'))
  writeFileSync(path.join(root, 'docs.json'), JSON.stringify({
    tabs: [{ tab: 'API', api: { source: 'openapi/x.json', overrides: { 'GET /hidden': { hidden: true } } } }],
  }))
  writeFileSync(path.join(root, 'openapi/x.json'), JSON.stringify({
    openapi: '3.1.0', info: { title: 'T', version: '1' },
    paths: {
      '/hidden': { $ref: '#/components/pathItems/Shared' },
      '/excluded': { get: { 'x-excluded': true, ...ok } },
      '/shown': { get: ok },
    },
    components: { pathItems: { Shared: { get: ok } } },
  }))
  const built = collectRuntimeContentFiles(root)
  state.sources = { ...built }
  for (const id of PAGES) state.sources[`src/content/${id}.mdx`] = { content: `---\ntitle: ${id}\n${frontmatter[id] ?? ''}\n---\nBody` }
})

/** A cold route: fresh modules, and the test's first call is the listing itself. */
const cold = async () => {
  vi.resetModules()
  return import('@/data/docs')
}
const ids = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id)
const PUBLISHED = ['a', 'b', 'typo-endpoint', 'shown-endpoint', 'c']

describe('the build records what the served spec no longer shows', () => {
  it('embeds the withheld operations, which the filtered spec copy cannot reveal', () => {
    const spec = JSON.parse(state.sources['openapi/x.json'].content) as { paths: object }
    expect(Object.keys(spec.paths)).toEqual(['/shown'])
    expect(JSON.parse(state.sources['thally-unpublished-operations.json'].content)).toEqual([
      { method: 'GET', path: '/hidden', state: 'hidden' },
      { method: 'GET', path: '/excluded', state: 'excluded' },
    ])
  })
})

describe('every listing is correct on its first call in a fresh module instance', () => {
  it('loadDocEntries (sitemap, llms.txt, llms-full, docs-index, /api/docs, search, MCP)', async () => {
    const docs = await cold()
    expect(ids(await docs.loadDocEntries())).toEqual(PUBLISHED)
  })

  it('getDocEntries and getSearchableDocs (skill.md, sync search source)', async () => {
    const docs = await cold()
    expect(ids(docs.getDocEntries())).toEqual(PUBLISHED)
    expect(ids((await cold()).getSearchableDocs())).toEqual(PUBLISHED)
  })

  it('loadSidebarCollections, getSidebarCollections and getNavigablePageIds', async () => {
    const hrefs = (docs: Awaited<ReturnType<typeof cold>>) => docs.getSidebarCollections()[0].sections.flatMap((section) => section.items.map((item) => item.href))
    const expected = PUBLISHED.map((id) => `/${id}`)
    const asyncDocs = await cold()
    expect((await asyncDocs.loadSidebarCollections())[0].sections.flatMap((section) => section.items.map((item) => item.href))).toEqual(expected)
    expect(hrefs(await cold())).toEqual(expected)
    expect([...(await cold()).getNavigablePageIds()]).toEqual(PUBLISHED)
  })

  it('previous/next, breadcrumbs and nav context', async () => {
    const docs = await cold()
    expect(docs.getPrevNextLinks('/b').next?.href).toBe('/typo-endpoint')
    expect(docs.getBreadcrumbs('/hidden-endpoint')).toEqual([])
    expect((await (await cold()).loadNavContext('typo-endpoint')).prev?.href).toBe('/b')
  })

  it('isDocPublished judges only what the build withheld; a typo stays published', async () => {
    const docs = await cold()
    expect(docs.isDocPublished('hidden-endpoint')).toBe(false)
    expect(docs.isDocPublished('excluded-endpoint')).toBe(false)
    expect(docs.isDocPublished('typo-endpoint')).toBe(true)
    expect(docs.isDocPublished('shown-endpoint')).toBe(true)
    expect(docs.isDocPublished('a')).toBe(true)
  })

  it('a site with no recorded operations lists everything', async () => {
    delete state.sources['thally-unpublished-operations.json']
    const docs = await cold()
    expect(ids(await docs.loadDocEntries())).toEqual(PAGES)
  })
})
