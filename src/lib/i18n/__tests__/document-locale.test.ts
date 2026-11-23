/** Initial HTML language follows a verified managed path without forcing static sites dynamic. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ headers: vi.fn(), remote: false }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/content-source', () => ({ isRemoteContentSource: () => mocks.remote }))
import { documentLocaleFromPath, DOCUMENT_PATH_HEADER } from '../document-locale'
import { getDocumentLocale } from '../request'
import { localeDirection } from '../config'
const i18n = { defaultLocale: 'en', locales: ['en', 'es', 'fr', 'ar'].map(code => ({ code, label: code })) }
beforeEach(() => { mocks.remote = false; mocks.headers.mockReset() })
afterEach(() => vi.restoreAllMocks())
describe('server document locale', () => {
  it.each([['/', 'en'], ['/es', 'es'], ['/fr/guide', 'fr'], ['/ar/guide', 'ar'], ['/unknown/guide', 'en'], [null, 'en']])('resolves %s to %s', (path, expected) => {
    expect(documentLocaleFromPath(path, i18n)).toBe(expected)
    expect(localeDirection(documentLocaleFromPath(path, i18n))).toBe(expected === 'ar' ? 'rtl' : 'ltr')
  })
  it('does not read dynamic request headers for filesystem sites', async () => {
    expect(await getDocumentLocale(i18n)).toBe('en')
    expect(mocks.headers).not.toHaveBeenCalled()
  })
  it('reads the middleware path for managed SSR', async () => {
    mocks.remote = true
    mocks.headers.mockResolvedValue(new Headers({ [DOCUMENT_PATH_HEADER]: '/fr/guide' }))
    expect(await getDocumentLocale(i18n)).toBe('fr')
  })
})
