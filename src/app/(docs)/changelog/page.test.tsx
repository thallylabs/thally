import { describe, expect, it, vi } from 'vitest'

const doc = vi.hoisted(() => ({ description: 'd', noindex: false }))

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/data/get-doc', () => ({
  // `access` is what getDocFromParams resolves from the file; open here.
  getDocFromParams: async () => ({ id: 'changelog', title: 'API Changelog', description: doc.description, noindex: doc.noindex, href: '/changelog', group: 'g', access: { groupSets: [], isMalformed: false } }),
}))
vi.mock('@/data/docs', () => ({ getBreadcrumbs: () => [], getSeoConfig: () => ({ titleSeparator: ' - ' }), canReaderViewPage: async () => true }))
vi.mock('@/components/docs/doc-layout', () => ({ DocLayout: () => null }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'OpenRouter | Documentation' }) }))
vi.mock('@/lib/og', () => ({ buildOgImageUrl: () => '', formatOgBreadcrumb: () => '', formatOgDisplayUrl: () => '' }))

vi.mock('@/lib/i18n/request', () => ({ getEffectiveI18nConfig: async () => ({ defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'es' }, { code: 'fr' }] }) }))
vi.mock('@/lib/i18n/content', () => ({ getContentI18nConfig: async (_slug: unknown, config: unknown) => config }))

import { generateMetadata } from './page'

describe('changelog page title', () => {
  it('uses the configured separator like other doc pages', async () => {
    const meta = await generateMetadata()
    expect(meta.title).toEqual({ absolute: 'API Changelog - OpenRouter | Documentation' })
  })
})

describe('changelog page description', () => {
  it('reads a code span as plain text in the meta and social tags', async () => {
    doc.description = 'Every `trigger.dev` release.'
    const meta = await generateMetadata()
    expect(meta.description).toBe('Every trigger.dev release.')
    expect(meta.openGraph?.description).toBe('Every trigger.dev release.')
    expect(meta.twitter?.description).toBe('Every trigger.dev release.')
  })
})


describe('changelog crawler metadata', () => {
  it('provides complete Open Graph and reciprocal published language targets', async () => {
    const meta = await generateMetadata()
    expect(meta.openGraph).toMatchObject({ type: 'article', url: 'https://docs.example.test/changelog' })
    expect(meta.alternates?.languages).toEqual({ en: 'https://docs.example.test/changelog', es: 'https://docs.example.test/es/changelog', fr: 'https://docs.example.test/fr/changelog', 'x-default': 'https://docs.example.test/changelog' })
  })
  it('does not add a noindex changelog to the hreflang cluster', async () => {
    doc.noindex = true
    const meta = await generateMetadata()
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect(meta.alternates?.languages).toBeUndefined()
    doc.noindex = false
  })
})
