import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/data/get-doc', () => ({
  getDocFromParams: async () => ({ title: 'API Changelog', description: 'd', href: '/changelog', group: 'g' }),
}))
vi.mock('@/data/docs', () => ({ getBreadcrumbs: () => [], getSeoConfig: () => ({ titleSeparator: ' - ' }) }))
vi.mock('@/components/docs/doc-layout', () => ({ DocLayout: () => null }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'OpenRouter | Documentation' }) }))
vi.mock('@/lib/og', () => ({ buildOgImageUrl: () => '', formatOgBreadcrumb: () => '', formatOgDisplayUrl: () => '' }))

import { generateMetadata } from './page'

describe('changelog page title', () => {
  it('uses the configured separator like other doc pages', async () => {
    const meta = await generateMetadata()
    expect(meta.title).toEqual({ absolute: 'API Changelog - OpenRouter | Documentation' })
  })
})
