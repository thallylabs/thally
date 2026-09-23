/** Negotiated representations retain the language and metadata of translated pages. */
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  hasDocTranslation: vi.fn(async () => true),
}))

vi.mock('@/data/docs', () => ({
  getDocEntries: () => [],
  loadDocEntries: async () => [{
    id: 'guide', slug: ['guide'], href: '/guide',
    title: 'Guide', description: 'Source description', keywords: ['source'],
  }],
  loadNavContext: async () => ({ tab: 'Docs', group: 'Guide', prev: null, next: null, breadcrumb: [] }),
}))
vi.mock('@/data/get-doc', () => ({ hasDocTranslation: mocks.hasDocTranslation }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
  }),
}))
vi.mock('@/lib/content', () => ({
  loadContentDocument: async (_id: string, locale?: string) => ({
    frontmatter: locale === 'fr'
      ? { title: 'Guide français', description: 'Description française', keywords: ['français'] }
      : { title: 'Guide' },
    content: {
      markdown: locale === 'fr' ? 'Texte français' : 'Source text',
      text: locale === 'fr' ? 'Texte français' : 'Source text',
      codeBlocks: [], links: [], headings: [], toc: [],
    },
  }),
}))
vi.mock('@/lib/site-config', () => ({ resolveSiteConfig: async () => ({ name: 'Docs' }) }))

import { GET } from './route'

describe('localized machine document', () => {
  it('serves translated JSON and a translated canonical URL', async () => {
    const response = await GET(
      new NextRequest('https://docs.example.com/api/docs/fr/guide?format=json'),
      { params: Promise.resolve({ slug: ['fr', 'guide'] }) },
    )
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      title: 'Guide français',
      description: 'Description française',
      canonical_url: 'https://docs.example.com/fr/guide',
      meta: { locale: 'fr', keywords: ['français'] },
      content: { text: 'Texte français' },
    })
    expect(response.headers.get('link')).toContain('</fr/guide>; rel="canonical"')
  })

  it('does not claim an untranslated fallback as a French document', async () => {
    mocks.hasDocTranslation.mockResolvedValueOnce(false)
    const response = await GET(
      new NextRequest('https://docs.example.com/api/docs/fr/guide?format=json'),
      { params: Promise.resolve({ slug: ['fr', 'guide'] }) },
    )
    expect(response.status).toBe(404)
  })
})
