/** Search enumeration follows live locale selection and exposes only indexable translations. */

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  asyncEntriesResolver: null as null | ((locale?: string) => Promise<Array<{ href: string }>>),
  getIndexableDocTranslation: vi.fn(),
}))

vi.mock('@thallylabs/core/registry', () => ({
  registerAsyncDocEntriesSource: (resolver: typeof mocks.asyncEntriesResolver) => {
    mocks.asyncEntriesResolver = resolver
  },
  registerDocEntriesSource: vi.fn(),
  registerAsyncContentDocumentSource: vi.fn(),
  registerContentDocumentSource: vi.fn(),
}))
vi.mock('@/data/docs', () => ({
  getDocEntries: () => [],
  loadDocEntries: async () => [
    { id: 'guide', slug: ['guide'], href: '/guide', title: 'Guide', description: 'Source', keywords: [] },
    { id: 'draft', slug: ['draft'], href: '/draft', title: 'Draft', description: 'Draft', keywords: [], noindex: true },
  ],
}))
vi.mock('@/lib/i18n/translation-source', () => ({ getIndexableDocTranslation: mocks.getIndexableDocTranslation }))
vi.mock('@/lib/content/document', () => ({ getContentDocument: vi.fn(), loadContentDocument: vi.fn() }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
  }),
}))

import '../register-doc-source'

describe('registered search doc entries', () => {
  it('enumerates a live-enabled locale and excludes noindex documents', async () => {
    mocks.getIndexableDocTranslation.mockResolvedValue({ title: 'Guide français' })

    expect(await mocks.asyncEntriesResolver?.('fr')).toEqual([{
      id: 'guide',
      href: '/fr/guide',
      title: 'Guide français',
      description: 'Source',
      keywords: [],
    }])
    expect(mocks.getIndexableDocTranslation).toHaveBeenCalledTimes(1)
  })
})
