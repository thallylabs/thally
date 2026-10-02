/** A site that redirects `/` to `/introduction` links the introduction page at its served URL. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ redirects: [] as Array<{ source: string; destination: string }> }))

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => ({
    tabs: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['introduction', 'guide'] }] }],
    redirects: state.redirects,
  }),
  getDocsJsonConfigRevision: () => state.redirects.length,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => ['src/content/introduction.mdx', 'src/content/guide.mdx'],
  readRuntimeSource: () => '---\ntitle: Page\n---\nBody',
  runtimeSourceExists: () => true,
}))

import { getDocEntries, getPrevNextLinks, getSidebarCollections } from './docs'

describe('introduction page links', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('uses /introduction when / redirects there', () => {
    state.redirects = [{ source: '/', destination: '/introduction' }]
    expect(getSidebarCollections()[0].sections[0].items.map((item) => item.href)).toEqual(['/introduction', '/guide'])
    expect(getDocEntries().find((entry) => entry.id === 'introduction')?.href).toBe('/introduction')
    expect(getPrevNextLinks('/introduction').next?.href).toBe('/guide')
  })

  it('keeps / when the root serves the introduction itself', () => {
    state.redirects = []
    expect(getSidebarCollections()[0].sections[0].items[0].href).toBe('/')
  })
})
