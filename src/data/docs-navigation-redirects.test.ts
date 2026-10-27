/**
 * A sidebar entry whose page only redirects links to where that redirect ends:
 * Next's client router follows the redirect but drops its `#fragment`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  config: { tabs: [] } as Record<string, unknown>,
  sources: {} as Record<string, string>,
}))

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => state.config,
  getDocsJsonConfigRevision: () => 1,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(state.sources),
  readRuntimeSource: (path: string) => state.sources[path] ?? '',
  runtimeSourceExists: (path: string) => path in state.sources,
  runtimeSourceModifiedAt: () => 0,
}))
vi.mock('@/lib/content-index', () => ({
  getContentIndex: () => null, loadContentIndex: async () => null, isIndexedContentPath: () => false,
}))

const PAGES = ['plain', 'cli/reference/agent', 'one', 'chain', 'carry', 'outside', 'loop-a', 'loop-b', 'Shouty', 'unsafe', 'cli/reference']

beforeEach(() => {
  vi.resetModules()
  state.sources = Object.fromEntries(PAGES.map((id) => [`src/content/${id}.mdx`, `---\ntitle: ${id}\n---\nBody\n`]))
  state.config = {
    tabs: [{ tab: 'Reference', pages: PAGES }],
    redirects: [
      { source: '/cli/reference/agent', destination: '/cli/reference#agent' },
      { source: '/one/', destination: '/landing?x=1#part' },
      { source: '/chain', destination: '/chain-2' },
      { source: '/chain-2', destination: '/final#anchor' },
      { source: '/carry', destination: '/carry-2#keep' },
      { source: '/carry-2', destination: '/carry-end' },
      { source: '/outside', destination: 'https://example.com/docs#top' },
      { source: '/loop-a', destination: '/loop-b' },
      { source: '/loop-b', destination: '/loop-a' },
      { source: '/shouty', destination: '/elsewhere' },
      { source: '/unsafe', destination: '//evil.example/x' },
      // Next applies the first match, so a later duplicate never changes the link.
      { source: '/cli/reference/agent', destination: '/not-this' },
    ],
  }
})

describe('sidebar entries for redirected pages', () => {
  it('links to the final destination and keeps the page route, title and position', async () => {
    const { getSidebarCollections } = await import('./docs')
    const items = getSidebarCollections()[0].sections[0].items
    expect(items.map((item) => item.href)).toEqual(PAGES.map((id) => `/${id}`))
    expect(items.map((item) => item.title)).toEqual(PAGES)
    const to = (id: string) => items.find((item) => item.href === `/${id}`)?.redirectTo
    expect(to('cli/reference/agent')).toBe('/cli/reference#agent')
    expect(to('one')).toBe('/landing?x=1#part')
    expect(to('chain')).toBe('/final#anchor')
    // A browser keeps the fragment across a redirect that names none.
    expect(to('carry')).toBe('/carry-end#keep')
    expect(to('outside')).toBe('https://example.com/docs#top')
    // A redirect source matches whatever its case and trailing slash.
    expect(to('Shouty')).toBe('/elsewhere')
  })

  it('leaves an entry alone when nothing redirects it or the redirect cannot be followed', async () => {
    const { getSidebarCollections } = await import('./docs')
    const items = getSidebarCollections()[0].sections[0].items
    for (const id of ['plain', 'cli/reference', 'loop-a', 'loop-b', 'unsafe']) {
      expect(items.find((item) => item.href === `/${id}`)).not.toHaveProperty('redirectTo')
    }
  })
})

/** Lay out a sidebar of `pages`, redirected by `redirects`, and read where each entry's link ends. */
async function redirectTargets(pages: Array<string>, redirects: Array<{ source: string; destination: string }>) {
  state.sources = Object.fromEntries(pages.map((id) => [`src/content/${id}.mdx`, `---\ntitle: ${id}\n---\nBody\n`]))
  state.config = { tabs: [{ tab: 'Reference', pages }], redirects }
  const { getSidebarCollections } = await import('./docs')
  const items = getSidebarCollections()[0].sections[0].items
  return (id: string) => items.find((item) => item.href === `/${id}`)?.redirectTo
}

describe('queries along a redirect chain', () => {
  // Next passes the request's query on to a redirect's destination, which may add to it:
  // `{ ...request.query, ...destination.query }` in prepareDestination.
  it('keeps the query a hop names through the hops after it', async () => {
    const to = await redirectTargets(['chain', 'middle'], [
      { source: '/chain', destination: '/middle?locale=fr' },
      { source: '/middle', destination: '/final#anchor' },
    ])
    expect(to('chain')).toBe('/final?locale=fr#anchor')
  })

  it('lets the destination win on a duplicate key and keeps the key where it first appeared', async () => {
    const to = await redirectTargets(['dup'], [
      { source: '/dup', destination: '/dup-2?locale=fr&a=1' },
      { source: '/dup-2', destination: '/dup-end?locale=de&b=2' },
    ])
    expect(to('dup')).toBe('/dup-end?locale=de&a=1&b=2')
  })

  it('combines a fragment and a query named in different hops', async () => {
    const to = await redirectTargets(['combo'], [
      { source: '/combo', destination: '/combo-2?a=1#first' },
      { source: '/combo-2', destination: '/combo-end?b=2' },
    ])
    expect(to('combo')).toBe('/combo-end?a=1&b=2#first')
  })

  it('keeps every value of a repeated key', async () => {
    const to = await redirectTargets(['tags'], [{ source: '/tags', destination: '/found?tag=a&tag=b#top' }])
    expect(to('tags')).toBe('/found?tag=a&tag=b#top')
  })

  it('carries the query on to an address outside the site', async () => {
    const to = await redirectTargets(['away'], [
      { source: '/away', destination: '/away-2?ref=docs' },
      { source: '/away-2', destination: 'https://example.com/landing?x=1' },
    ])
    expect(to('away')).toBe('https://example.com/landing?ref=docs&x=1')
  })
})
