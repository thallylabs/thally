/** Initial HTML language follows the authored body, never a requested fallback. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pathname: '/es/quickstart' as string | null,
  files: {} as Record<string, string>,
  operation: null as object | null,
  headers: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: state.headers }))
vi.mock('@/data/docs', () => ({ getI18nConfig: () => ({ defaultLocale: 'en' }) }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    exists: async (path: string) => path in state.files,
    read: async (path: string) => path in state.files ? { content: state.files[path] } : null,
  }),
}))
vi.mock('@/data/api-reference', () => ({ getApiOperationBySlug: async () => state.operation }))

import { getDocumentLocale } from '../document'
import { localeDirection, type I18nConfig } from '../config'
import { DOCUMENT_PATH_HEADER } from '../document-path'

const config: I18nConfig = {
  defaultLocale: 'en',
  locales: ['en', 'es', 'fr', 'ar', 'pt-BR'].map(code => ({ code, label: code })),
}

beforeEach(() => {
  state.pathname = '/es/quickstart'
  state.operation = null
  state.files = { 'src/content/quickstart.mdx': 'English source' }
  state.headers.mockReset().mockImplementation(async () => new Headers(state.pathname ? { [DOCUMENT_PATH_HEADER]: state.pathname } : {}))
})

describe('server document locale', () => {
  it.each(['es', 'fr', 'ar', 'pt-BR'])('selects an authored %s translation and its direction', async locale => {
    state.pathname = `/${locale}/quickstart`
    state.files[`src/content/${locale}/quickstart.mdx`] = 'Translated body'
    const result = await getDocumentLocale(config)
    expect(result).toBe(locale)
    expect(localeDirection(result)).toBe(locale === 'ar' ? 'rtl' : 'ltr')
  })

  it('keeps source-language fallbacks, missing pages and orphan translations in the default language', async () => {
    expect(await getDocumentLocale(config)).toBe('en')
    state.files = { 'src/content/es/quickstart.mdx': 'Orphan translation' }
    expect(await getDocumentLocale(config)).toBe('en')
    state.files = {}
    expect(await getDocumentLocale(config)).toBe('en')
  })

  it('does not confuse noindex or hidden translations with English fallbacks', async () => {
    state.files['src/content/es/quickstart.mdx'] = '---\nnoindex: true\nhidden: true\n---\nTexto español'
    expect(await getDocumentLocale(config)).toBe('es')
  })

  it('resolves translated home and index files', async () => {
    state.pathname = '/fr'
    state.files = { 'src/content/introduction.mdx': 'Home', 'src/content/fr/introduction/index.mdx': 'Accueil' }
    expect(await getDocumentLocale(config)).toBe('fr')
  })

  it('keeps generated OpenAPI prose in the source language and allows authored API translations', async () => {
    state.pathname = '/es/api/overview'
    state.files = { 'src/content/api/overview.mdx': 'Source', 'src/content/es/api/overview.mdx': 'Traducción' }
    state.operation = { operation: {} }
    expect(await getDocumentLocale(config)).toBe('en')
    state.operation = null
    expect(await getDocumentLocale(config)).toBe('es')
  })

  it.each([null, '/', '/admin', '/quickstart', '/de/quickstart', '/en/quickstart', '//es/quickstart', '/es/%E0%A4%A', '/es/../quickstart'])('uses the source locale for %s', async pathname => {
    state.pathname = pathname
    expect(await getDocumentLocale(config)).toBe('en')
  })

  it('keeps single-locale sites statically renderable without reading request headers', async () => {
    expect(await getDocumentLocale({ defaultLocale: 'fr', locales: [{ code: 'fr', label: 'Français' }] })).toBe('fr')
    expect(state.headers).not.toHaveBeenCalled()
  })
})
