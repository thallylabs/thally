/** A page whose `openapi:` frontmatter cannot be resolved keeps its authored body. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ published: true }))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/data/get-doc', () => ({
  getDocFromParams: async () => ({
    id: 'api-reference/endpoint/scrape',
    title: 'Scrape',
    description: '',
    slug: ['api-reference', 'endpoint', 'scrape'],
    keywords: [],
    lastUpdated: '2026-01-01',
    component: () => <p>Authored scrape body</p>,
    openapi: { specId: 'default', specRef: 'openapi/missing.json', method: 'POST', path: '/scrape' },
  }),
}))
vi.mock('@/data/api-reference', () => ({ getApiOperationForFrontmatter: async () => null }))
vi.mock('@/data/docs', () => ({
  ensureDocPublication: async () => undefined,
  getDocEntries: async () => [],
  isDocPublished: () => fixtures.published,
  loadNavContext: async () => ({ breadcrumb: [] }),
}))
vi.mock('@/components/docs/doc-layout', () => ({ DocLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/docs/doc-header', () => ({ DocHeader: () => null }))
vi.mock('@/components/api/api-layout', () => ({ ApiLayout: () => null }))
vi.mock('@/components/api/operation-panel', () => ({ OperationPanel: () => null }))
vi.mock('@/components/api/manual-api-endpoint', () => ({ ManualApiEndpoint: () => null }))
vi.mock('@/components/seo/json-ld-script', () => ({ JsonLdScript: () => null }))
vi.mock('@/components/layout/localized-sidebar-hydrator', () => ({ LocalizedSidebarHydrator: () => null }))
vi.mock('@/components/layout/locale-availability', () => ({ LocaleAvailabilityHydrator: () => null }))
vi.mock('@/components/docs/locale-fallback-banner', () => ({ LocaleFallbackBanner: () => null }))
vi.mock('@/components/docs/locale-stale-banner', () => ({ LocaleStaleBanner: () => null }))
vi.mock('@/lib/i18n/request', () => ({ getEffectiveI18nConfig: async () => ({ defaultLocale: 'en', locales: [{ code: 'en' }] }) }))
vi.mock('@/lib/i18n/content', () => ({ getContentI18nConfig: async () => ({ locales: [] }) }))
vi.mock('@/lib/i18n/navigation', () => ({ localizeDocNavigation: async (nav: unknown) => nav }))
vi.mock('@/lib/i18n/translation-source', () => ({ hasDocTranslation: async () => false }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'Docs' }) }))
vi.mock('@/lib/content-source', () => ({ isRemoteContentSource: () => false }))
vi.mock('@/lib/agent-discovery', () => ({ buildAgentAlternateLinks: () => ({}) }))
vi.mock('@/lib/og', () => ({ buildOgImageUrl: () => '', formatOgBreadcrumb: () => '', formatOgDisplayUrl: () => '' }))
vi.mock('@/lib/i18n/metadata', () => ({ buildLocaleAlternates: () => ({}) }))
vi.mock('@/lib/json-ld', () => ({ buildDocPageJsonLd: () => ({}) }))

import DocsPage from './page'

const render = async () => renderToStaticMarkup(await DocsPage({ params: Promise.resolve({ slug: ['api-reference', 'endpoint', 'scrape'] }) }))

describe('docs page with an unresolved openapi spec', () => {
  it('renders the authored body with a notice', async () => {
    fixtures.published = true
    const html = await render()
    expect(html).toContain('Authored scrape body')
    expect(html).toContain('role="note"')
  })

  it('still 404s a page the build withheld for a hidden operation', async () => {
    fixtures.published = false
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
