/** The source changelog and its translated routes must form one truthful cluster. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const state = vi.hoisted(() => ({
  description: 'd',
  noindex: false,
  allowed: true,
  missing: false,
  translations: ['es', 'fr'],
  excluded: [] as string[],
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/data/get-doc', () => ({
  getDocFromParams: async (slug: string[], locale?: string) => state.missing || slug.join('/') !== 'changelog' ? null : ({
    id: 'changelog', slug: ['changelog'], title: 'API Changelog', description: state.description,
    href: '/changelog', group: 'g', component: () => <p>Changelog releases</p>,
    noindex: state.noindex || Boolean(locale && state.excluded.includes(locale)),
    isFallback: Boolean(locale && !state.translations.includes(locale)),
  }),
}))
vi.mock('@/data/docs', () => ({
  ensureDocPublication: async () => undefined,
  isDocPublished: () => true,
  getSeoConfig: () => ({ titleSeparator: ' - ' }),
  loadNavContext: async () => ({ breadcrumb: [], prev: null, next: null }),
  getApiPlaygroundDisplay: () => undefined,
}))
vi.mock('@/lib/reader-auth/context', () => ({ getReaderContext: async () => ({}) }))
vi.mock('@/lib/reader-auth/page-gate', () => ({
  canReaderViewResolvedDoc: async () => state.allowed,
  denyDocumentAccess: () => { throw new Error('document-denied') },
}))
vi.mock('@/lib/reader-auth/config', () => ({ isReaderAuthActive: () => false }))
vi.mock('@/data/api-reference', () => ({ lookupApiOperationForFrontmatter: async () => ({ node: null }) }))
vi.mock('@/components/docs/doc-layout', () => ({ DocLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/docs/doc-pagination', () => ({ DocPagination: () => null }))
vi.mock('@/components/docs/doc-header', () => ({ DocHeader: () => null }))
vi.mock('@/components/api/api-layout', () => ({ ApiLayout: () => null }))
vi.mock('@/components/api/operation-panel', () => ({ OperationPanel: () => null }))
vi.mock('@/components/api/manual-api-endpoint', () => ({ ManualApiEndpoint: () => null }))
vi.mock('@/components/layout/localized-sidebar-hydrator', () => ({ LocalizedSidebarHydrator: () => null }))
vi.mock('@/components/layout/locale-availability', () => ({ LocaleAvailabilityHydrator: () => null }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({ defaultLocale: 'en', locales: ['en', 'es', 'fr'].map(code => ({ code, label: code })) }),
}))
vi.mock('@/lib/i18n/translation-source', () => ({
  getIndexableDocTranslation: async (_slug: string[], locale: string) =>
    !state.noindex && state.translations.includes(locale) && !state.excluded.includes(locale) ? { title: 'Translated' } : null,
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'OpenRouter | Documentation' }) }))
vi.mock('@/lib/og', () => ({ buildOgImageUrl: () => '', formatOgBreadcrumb: () => '', formatOgDisplayUrl: () => '' }))

import ChangelogPage, { generateMetadata } from './page'
import { generateMetadata as generateDocsMetadata } from '@/app/(docs)/[[...slug]]/page'

const translatedMetadata = (locale: string) => generateDocsMetadata({ params: Promise.resolve({ slug: [locale, 'changelog'] }) })

beforeEach(() => {
  state.description = 'd'; state.noindex = false; state.allowed = true; state.missing = false
  state.translations = ['es', 'fr']; state.excluded = []
})

describe('changelog page metadata', () => {
  it('renders the changelog body and preserves missing or denied document handling', async () => {
    expect(renderToStaticMarkup(await ChangelogPage())).toContain('Changelog releases')
    state.missing = true
    await expect(ChangelogPage()).rejects.toThrow('document-denied')
    state.missing = false; state.allowed = false
    await expect(ChangelogPage()).rejects.toThrow('document-denied')
  })

  it('uses the configured separator like other doc pages', async () => {
    expect((await generateMetadata()).title).toEqual({ absolute: 'API Changelog - OpenRouter | Documentation' })
  })

  it('reads a code span as plain text in the meta and social tags', async () => {
    state.description = 'Every `trigger.dev` release.'
    const meta = await generateMetadata()
    expect(meta.description).toBe('Every trigger.dev release.')
    expect(meta.openGraph?.description).toBe('Every trigger.dev release.')
    expect(meta.twitter?.description).toBe('Every trigger.dev release.')
  })

  it('emits identical reciprocal language sets on the source and translated routes', async () => {
    const cluster = {
      en: 'https://docs.example.test/changelog', es: 'https://docs.example.test/es/changelog',
      fr: 'https://docs.example.test/fr/changelog', 'x-default': 'https://docs.example.test/changelog',
    }
    expect((await generateMetadata()).alternates?.languages).toEqual(cluster)
    for (const locale of ['es', 'fr']) {
      const metadata = await translatedMetadata(locale)
      expect(metadata.alternates?.languages).toEqual(cluster)
      expect(metadata.alternates?.canonical).toBe(cluster[locale as 'es' | 'fr'])
    }
  })

  it('omits unavailable and noindex translations from every indexable member', async () => {
    state.translations = ['es']
    expect((await generateMetadata()).alternates?.languages).not.toHaveProperty('fr')
    const fallback = await translatedMetadata('fr')
    expect(fallback.robots).toEqual({ index: false, follow: true })
    expect(fallback.alternates?.canonical).toBe('https://docs.example.test/changelog')
    expect(fallback.alternates?.languages).toBeUndefined()

    state.translations = ['es', 'fr']; state.excluded = ['fr']
    expect((await generateMetadata()).alternates?.languages).not.toHaveProperty('fr')
    expect((await translatedMetadata('es')).alternates?.languages).not.toHaveProperty('fr')
    expect((await translatedMetadata('fr')).alternates?.languages).toBeUndefined()
  })

  it('does not advertise a source changelog marked noindex or denied to the reader', async () => {
    state.noindex = true
    const noindex = await generateMetadata()
    expect(noindex.robots).toEqual({ index: false, follow: false })
    expect(noindex.alternates?.languages).toBeUndefined()
    state.allowed = false
    expect(await generateMetadata()).toEqual({})
  })
})
