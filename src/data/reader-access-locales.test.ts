/**
 * Reader access on localized and alternate-spelling routes.
 *
 * A translation may restrict its page further than the primary file, and a
 * translation that forgets `groups` must not open a restricted primary page.
 * Every projection of a localized page judges the translation and the
 * primary together; a page id with no backing file is closed, never open.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const MARKER = 'LOCALE-SECRET-41aa'
const state = vi.hoisted(() => ({ sources: {} as Record<string, string> }))
const config = vi.hoisted(() => ({
  auth: { mode: 'jwt', default: 'public' },
  markdown: { enabled: true },
  i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }] },
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: ['guides/open', 'guides/secret'] }] }],
}))

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(state.sources),
  readRuntimeSource: (file: string) => state.sources[file],
  runtimeSourceExists: (file: string) => file in state.sources,
  runtimeSourceModifiedAt: () => null,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null, isIndexedContentPath: () => false }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default', specs: [] }, getOpenApiSpecUrl: () => null }))
vi.mock('@/data/api-reference', () => ({
  getAllApiOperationNodes: async () => [],
  servedSpecPathForFrontmatter: async () => undefined,
  withApiNavigation: async (collections: unknown) => collections,
}))
vi.mock('@/lib/cloud-link/client', () => ({ getCloudSiteConfig: async () => null }))
vi.mock('@/lib/i18n/request', () => {
  const i18n = { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }] }
  return { getEffectiveI18nConfig: async () => i18n, getRepositoryI18nConfig: () => i18n }
})

let betaToken = ''

beforeAll(async () => {
  vi.stubEnv('THALLY_READER_SESSION_SECRET', 's'.repeat(40))
  vi.stubEnv('THALLY_READER_TOKEN_KEYS', `k1:${'t'.repeat(40)}`)
  state.sources = {
    'src/content/guides/open.mdx': '---\ntitle: Open guide\n---\nOpen body.\n',
    // The translation alone restricts the page.
    'src/content/fr/guides/open.mdx': `---\ntitle: Guide restreint\ndescription: Réservé\ngroups: [beta]\n---\n${MARKER} fr-open\n`,
    'src/content/guides/secret.mdx': `---\ntitle: Secret roadmap\ngroups: [beta]\n---\n${MARKER} en-secret\n`,
    // The translation forgets `groups`: the primary's restriction still applies.
    'src/content/fr/guides/secret.mdx': `---\ntitle: Feuille de route\n---\n${MARKER} fr-secret\n`,
  }
  const { mintAgentToken } = await import('@/lib/reader-auth/session')
  betaToken = (await mintAgentToken({ label: 'ci', groups: ['beta'], expiresInSeconds: 3600 })).token
})

afterAll(() => vi.unstubAllEnvs())

beforeEach(async () => {
  const { resetReaderAuthConfigForTests } = await import('@/lib/reader-auth/config')
  resetReaderAuthConfigForTests()
})

const anonymous = (path: string) => new NextRequest(`https://docs.example.com${path}`)
const withToken = (path: string) => new NextRequest(`https://docs.example.com${path}`, { headers: { authorization: `Bearer ${betaToken}` } })

describe('localized reader access', () => {
  it('/api/docs-index omits a translation that restricts its page', async () => {
    const { GET } = await import('@/app/api/docs-index/route')
    const anon = await (await GET(anonymous('/api/docs-index?locale=fr'))).text()
    expect(anon).not.toContain('Guide restreint')
    expect(anon).not.toContain('Réservé')
    expect(await (await GET(withToken('/api/docs-index?locale=fr'))).text()).toContain('Guide restreint')
  })

  it('the shared search corpus omits a translation that restricts its page', async () => {
    await import('@/lib/search/register-doc-source')
    const { resolveDocEntriesAsync } = await import('@thallylabs/core/registry')
    const french = await resolveDocEntriesAsync('fr')
    expect(JSON.stringify(french)).not.toContain('Guide restreint')
    expect(JSON.stringify(french)).not.toContain('Feuille de route')
  })

  it('the localized .md mirror applies the primary page rules to a translation that omits them', async () => {
    const { GET } = await import('@/app/api/markdown/[...slug]/route')
    const params = { params: Promise.resolve({ slug: ['fr', 'guides', 'secret'] }) }
    expect((await GET(anonymous('/api/markdown/fr/guides/secret'), params)).status).toBe(404)
    expect((await GET(withToken('/api/markdown/fr/guides/secret'), { params: Promise.resolve({ slug: ['fr', 'guides', 'secret'] }) })).status).toBe(200)
  })

  it('a localized /api/docs request applies both files', async () => {
    const { GET } = await import('@/app/api/docs/[...slug]/route')
    const response = await GET(anonymous('/api/docs/fr/guides/open?format=json'), { params: Promise.resolve({ slug: ['fr', 'guides', 'open'] }) })
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(MARKER)
  })
})

describe('ids without a backing file', () => {
  it('fail closed instead of defaulting to open access', async () => {
    const { canReaderViewPage, getPageAccess } = await import('@/data/docs')
    const { resolveReader } = await import('@/lib/reader-auth/context')
    const beta = await resolveReader(`Bearer ${betaToken}`, null)
    expect(getPageAccess('guides/secret.mdx').isMalformed).toBe(true)
    expect(await canReaderViewPage('guides/secret.mdx', beta)).toBe(false)
    expect(await canReaderViewPage('guides/open')).toBe(true)
  })
})
