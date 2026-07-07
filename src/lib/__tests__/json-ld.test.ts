import { describe, expect, it } from 'vitest'
import {
  buildApiOperationJsonLd,
  buildBreadcrumbListJsonLd,
  buildDocPageJsonLd,
  buildSiteJsonLd,
} from '@/lib/json-ld'

const siteUrl = 'https://docs.example.com'

describe('buildSiteJsonLd', () => {
  it('emits WebSite and Organization in a graph', () => {
    const result = buildSiteJsonLd({
      siteUrl,
      siteName: 'Example Docs',
      description: 'Product documentation',
      repoUrl: 'https://github.com/example/docs',
      locale: 'en',
    })

    expect(result['@context']).toBe('https://schema.org')
    expect(result['@graph']).toHaveLength(2)
    expect(result['@graph'][0]).toMatchObject({
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      name: 'Example Docs',
      inLanguage: 'en',
    })
    expect(result['@graph'][1]).toMatchObject({
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      sameAs: ['https://github.com/example/docs'],
    })
  })
})

describe('buildDocPageJsonLd', () => {
  it('includes TechArticle fields and breadcrumb list', () => {
    const pageUrl = `${siteUrl}/guides/authentication`
    const result = buildDocPageJsonLd({
      siteUrl,
      siteName: 'Example Docs',
      pageUrl,
      id: 'guides/authentication',
      title: 'Authentication',
      description: 'How to authenticate API requests.',
      keywords: ['auth', 'tokens'],
      lastUpdated: '2026-02-01',
      locale: 'en',
      breadcrumb: [
        { label: 'Guides', href: '/guides/getting-started' },
        { label: 'Security' },
        { label: 'Authentication' },
      ],
    })

    expect(result['@graph']).toHaveLength(2)
    expect(result['@graph'][0]).toMatchObject({
      '@type': 'TechArticle',
      headline: 'Authentication',
      identifier: 'guides/authentication',
      keywords: 'auth, tokens',
      dateModified: '2026-02-01',
      isPartOf: { '@id': `${siteUrl}/#website` },
    })
    expect(result['@graph'][1]).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { position: 1, name: 'Guides', item: `${siteUrl}/guides/getting-started` },
        { position: 2, name: 'Security' },
        { position: 3, name: 'Authentication', item: pageUrl },
      ],
    })
  })
})

describe('buildApiOperationJsonLd', () => {
  it('links API operations to the OpenAPI spec', () => {
    const pageUrl = `${siteUrl}/api/list-pets`
    const result = buildApiOperationJsonLd({
      siteUrl,
      pageUrl,
      title: 'List pets',
      description: 'Fetch a paginated list of pets.',
      specUrl: `${siteUrl}/openapi.yaml`,
      method: 'GET',
      path: '/pets',
    })

    expect(result['@graph'][0]).toMatchObject({
      '@type': 'TechArticle',
      isBasedOn: `${siteUrl}/openapi.yaml`,
      about: {
        '@type': 'WebAPI',
        documentation: 'GET /pets',
      },
    })
  })
})

describe('buildBreadcrumbListJsonLd', () => {
  it('returns null for empty breadcrumbs', () => {
    expect(buildBreadcrumbListJsonLd([], siteUrl, `${siteUrl}/page`)).toBeNull()
  })
})
