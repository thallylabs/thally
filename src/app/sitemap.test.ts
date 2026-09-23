/** Sitemap languages and dates come from indexable versions of each document. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ translated: vi.fn() }))
vi.mock('@/data/docs', () => ({
  loadDocEntries: async () => [{
    id: 'guide', slug: ['guide'], href: '/guide', hidden: false, noindex: false,
    lastUpdated: '2026-01-01',
  }],
}))
vi.mock('@/data/api-reference', () => ({ getAllApiOperationNodes: async () => [] }))
vi.mock('@/lib/cloud-link/request', () => ({ getRequestOrigin: async () => 'https://docs.example.com' }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
  }),
}))
vi.mock('@/data/get-doc', () => ({ getIndexableDocTranslation: mocks.translated }))

import sitemap from './sitemap'

beforeEach(() => mocks.translated.mockReset())

describe('localized sitemap', () => {
  it('does not advertise a missing or noindex translation', async () => {
    mocks.translated.mockResolvedValue(null)
    const urls = await sitemap()
    expect(urls.filter((entry) => entry.url.endsWith('/guide'))).toHaveLength(1)
    expect(urls.some((entry) => entry.url.endsWith('/fr/guide'))).toBe(false)
    expect(urls.find((entry) => entry.url.endsWith('/guide'))?.alternates?.languages).toEqual({
      en: 'https://docs.example.com/guide',
      'x-default': 'https://docs.example.com/guide',
    })
  })

  it('uses the translated page date for its localized URL', async () => {
    mocks.translated.mockResolvedValue({ modifiedAtMs: 1, lastUpdated: '2026-02-03' })
    const urls = await sitemap()
    const translated = urls.find((entry) => entry.url.endsWith('/fr/guide'))
    expect(translated?.lastModified).toEqual(new Date('2026-02-03'))
    expect(translated?.alternates?.languages).toHaveProperty('fr', translated?.url)
  })
})
