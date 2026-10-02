/** Sidebar entries for pages with `openapi:` frontmatter know their HTTP method. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => ({
    tabs: [{ tab: 'API', groups: [{ group: 'Endpoints', pages: ['api/scrape', 'api/hook', 'api/errors'] }] }],
  }),
  getDocsJsonConfigRevision: () => 1,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => ['src/content/api/scrape.mdx', 'src/content/api/hook.mdx', 'src/content/api/errors.mdx'],
  readRuntimeSource: (path: string) =>
    path.endsWith('scrape.mdx')
      ? '---\ntitle: Scrape\nopenapi: "openapi/v2.json delete /scrape"\n---\nBody'
      : path.endsWith('hook.mdx')
        ? '---\ntitle: Hook\nopenapi: "openapi/w.json webhook crawlPage"\n---\nBody'
        : '---\ntitle: Errors\n---\nBody',
  runtimeSourceExists: () => true,
}))

import { getSidebarCollections } from './docs'

describe('sidebar method', () => {
  it('carries the upper-cased operation method, HOOK for webhooks, and nothing for plain pages', () => {
    const items = getSidebarCollections()[0].sections[0].items
    expect(items.map((item) => item.method)).toEqual(['DELETE', 'HOOK', undefined])
  })
})
