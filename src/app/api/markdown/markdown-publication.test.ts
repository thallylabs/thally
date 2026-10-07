import { describe, expect, it, vi } from 'vitest'

const published = vi.hoisted(() => new Set(['visible']))
vi.mock('@/data/docs', () => ({
  ensureDocPublication: async () => undefined,
  isDocPublished: (id: string) => published.has(id),
  canReaderViewPage: async () => true,
}))
vi.mock('@/lib/cloud-link/client', () => ({ getCloudSiteConfig: async () => null }))
vi.mock('@/lib/markdown-pages', () => ({ isMarkdownPagesEnabled: () => true }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    read: async (file: string) => (/(visible|hidden-endpoint)\.mdx$/.test(file) ? { content: '---\ntitle: T\n---\nBody' } : null),
  }),
}))

import { GET } from './[...slug]/route'

const get = (slug: string) => GET(new Request('http://localhost/api/markdown/' + slug), { params: Promise.resolve({ slug: slug.split('/') }) })

describe('/api/markdown (the .md mirror)', () => {
  it('serves a published page', async () => {
    expect((await get('visible')).status).toBe(200)
  })

  it('404s a page whose documented operation is hidden or excluded, like its HTML route', async () => {
    expect((await get('hidden-endpoint')).status).toBe(404)
  })
})
