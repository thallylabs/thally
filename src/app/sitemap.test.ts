/** Sitemap languages and dates come from indexable versions of each document. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ translated: vi.fn(), connection: vi.fn(), assets: false, calls: [] as string[] }))
vi.mock('next/server', () => ({ connection: mocks.connection }))
vi.mock('@/lib/content-source', () => ({ isRemoteContentSource: () => mocks.assets }))
const docs = vi.hoisted(() => ({ sitemap: undefined as 'navigable' | undefined, introductionHref: '/', hasChangelog: false }))
vi.mock('@/data/docs', () => ({
  loadDocEntries: async () => { mocks.calls.push('content'); return [
    { id: 'guide', slug: ['guide'], href: '/guide', hidden: false, noindex: false, lastUpdated: '2026-01-01' },
    { id: 'introduction', slug: [], href: docs.introductionHref, hidden: false, noindex: false },
    ...(docs.hasChangelog ? [{ id: 'changelog', slug: ['changelog'], href: '/changelog', hidden: false, noindex: false, lastUpdated: '2026-03-01' }] : []),
    { id: 'orphan', slug: ['orphan'], href: '/orphan', hidden: false, noindex: false },
  ] },
  canReaderViewPage: async () => true,
  getSeoConfig: () => ({ sitemap: docs.sitemap }),
  getVisiblePageIds: () => new Set(['guide', 'introduction']),
}))
vi.mock('@/data/api-reference', () => ({ getAllApiOperationNodes: async () => [] }))
vi.mock('@/lib/cloud-link/request', () => ({ getRequestOrigin: async () => { mocks.calls.push('origin'); return 'https://docs.example.com' } }))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
  }),
}))
vi.mock('@/lib/i18n/translation-source', () => ({ getIndexableDocTranslation: mocks.translated }))

import sitemap from './sitemap'

beforeEach(() => {
  mocks.translated.mockReset()
  mocks.assets = false
  mocks.calls = []
  mocks.connection.mockReset().mockImplementation(async () => { mocks.calls.push('connection') })
  docs.sitemap = undefined
  docs.introductionHref = '/'
  docs.hasChangelog = false
})

describe('release-backed sitemap request boundary', () => {
  it('waits for a request before configured origin or asset metadata, even when the origin itself is static', async () => {
    mocks.assets = true
    mocks.translated.mockResolvedValue(null)
    await sitemap()
    expect(mocks.connection).toHaveBeenCalledOnce()
    expect(mocks.calls.slice(0, 3)).toEqual(['connection', 'origin', 'content'])
  })
  it('keeps filesystem sitemap generation independent of a request', async () => {
    mocks.translated.mockResolvedValue(null)
    await sitemap()
    expect(mocks.connection).not.toHaveBeenCalled()
  })
})

describe('static sitemap entries', () => {
  it('lists a changelog once and retains its localized document metadata', async () => {
    docs.hasChangelog = true
    mocks.translated.mockResolvedValue({ lastUpdated: '2026-03-02' })
    const urls = await sitemap()
    const entries = urls.filter(entry => entry.url === 'https://docs.example.com/changelog')
    expect(entries).toHaveLength(1)
    expect(entries[0].lastModified).toEqual(new Date('2026-03-01'))
    expect(entries[0].alternates?.languages).toHaveProperty('fr', 'https://docs.example.com/fr/changelog')
  })
  it('omits /changelog when the site has no changelog page, since that URL 404s', async () => {
    mocks.translated.mockResolvedValue(null)
    const urls = await sitemap()
    expect(urls.some((entry) => entry.url.endsWith('/changelog'))).toBe(false)
  })
})

describe('navigable-only sitemap', () => {
  it('lists every page by default and only navigation pages when docs.json asks for it', async () => {
    mocks.translated.mockResolvedValue(null)
    expect((await sitemap()).some((entry) => entry.url.endsWith('/orphan'))).toBe(true)
    docs.sitemap = 'navigable'
    const urls = await sitemap()
    expect(urls.some((entry) => entry.url.endsWith('/orphan'))).toBe(false)
    expect(urls.some((entry) => entry.url.endsWith('/guide'))).toBe(true)
    // The introduction page is served at `/` unless the site redirects `/` to it.
    expect(urls.some((entry) => entry.url === 'https://docs.example.com/')).toBe(true)
    expect(urls.some((entry) => entry.url === 'https://docs.example.com/introduction')).toBe(false)
    docs.introductionHref = '/introduction'
    const redirected = await sitemap()
    expect(redirected.some((entry) => entry.url === 'https://docs.example.com/introduction')).toBe(true)
    expect(redirected.some((entry) => entry.url === 'https://docs.example.com/')).toBe(false)
    // Mintlify's sitemap lists documentation pages only, not the agent text files.
    expect(urls.some((entry) => /\/(llms|ai)\.txt$/.test(entry.url))).toBe(false)
  })
})

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
