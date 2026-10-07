/**
 * HTML and RSC enforcement for restricted pages on the document route.
 *
 * The same server render produces both the HTML document and the App Router
 * payload, so denying it here covers both. A restricted page must be
 * indistinguishable from a missing one: no metadata, the same 404 (or, on a
 * private-by-default site, the same same-origin sign-in hop).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MARKER = 'SECRET-MARKER-page'
const state = vi.hoisted(() => ({
  sources: {} as Record<string, string>,
  cookie: undefined as string | undefined,
  authorization: null as string | null,
}))
const config = vi.hoisted(() => ({
  auth: { mode: 'jwt', default: 'public' } as Record<string, unknown>,
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: ['guides/open', 'guides/secret'] }] }],
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (state.cookie && name === 'thally_reader' ? { value: state.cookie } : undefined) }),
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))
vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => Object.keys(state.sources),
  readRuntimeSource: (file: string) => state.sources[file],
  runtimeSourceExists: (file: string) => file in state.sources,
  runtimeSourceModifiedAt: () => null,
}))
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null, isIndexedContentPath: () => false }))
vi.mock('@/data/get-doc', () => ({
  getDocFromParams: async (slug?: Array<string>) => {
    const id = (slug ?? []).join('/')
    // An alternate spelling of a route that resolves the secret FILE under
    // the open page's id: access must come from the resolved file.
    if (id === 'guides/alias') {
      return {
        id: 'guides/open', title: 'Secret roadmap', description: '', slug: ['guides', 'alias'], href: '/guides/alias', keywords: [], lastUpdated: '',
        component: () => <p>{MARKER}</p>,
        access: { groupSets: [['beta']], isMalformed: false },
      }
    }
    if (!['guides/open', 'guides/secret'].includes(id)) return null
    return {
      access: id === 'guides/secret' ? { groupSets: [['beta']], isMalformed: false } : { groupSets: [], isMalformed: false },
      id,
      title: id === 'guides/secret' ? 'Secret roadmap' : 'Open guide',
      description: '',
      slug: id.split('/'),
      href: `/${id}`,
      keywords: [],
      lastUpdated: '',
      component: () => <p>{id === 'guides/secret' ? MARKER : 'Open body'}</p>,
    }
  },
}))
vi.mock('@/data/api-reference', () => ({ lookupApiOperationForFrontmatter: async () => ({ node: null, reason: 'unresolved' }) }))
vi.mock('@/components/docs/doc-layout', () => ({ DocLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/layout/localized-sidebar-hydrator', () => ({ LocalizedSidebarHydrator: () => null }))
vi.mock('@/components/layout/locale-availability', () => ({ LocaleAvailabilityHydrator: () => null }))
vi.mock('@/components/seo/json-ld-script', () => ({ JsonLdScript: () => null }))
vi.mock('@/lib/i18n/request', () => {
  const i18n = { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] }
  return { getEffectiveI18nConfig: async () => i18n, getRepositoryI18nConfig: () => i18n }
})
vi.mock('@/lib/i18n/content', () => ({ getContentI18nConfig: async () => ({ defaultLocale: 'en', locales: [] }) }))
vi.mock('@/lib/i18n/navigation', () => ({ localizeDocNavigation: async (nav: unknown) => nav }))
vi.mock('@/lib/i18n/translation-source', () => ({ hasDocTranslation: async () => false }))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'Docs' }) }))
vi.mock('@/lib/content-source', () => ({ isRemoteContentSource: () => false }))
vi.mock('@/lib/agent-discovery', () => ({ buildAgentAlternateLinks: () => ({}) }))
vi.mock('@/lib/og', () => ({ buildOgImageUrl: () => '', formatOgBreadcrumb: () => '', formatOgDisplayUrl: () => '' }))
vi.mock('@/lib/i18n/metadata', () => ({ buildLocaleAlternates: () => ({}) }))
vi.mock('@/lib/json-ld', () => ({ buildDocPageJsonLd: () => ({}) }))

import DocsPage, { generateMetadata } from './page'
import { resetReaderAuthConfigForTests } from '@/lib/reader-auth/config'
import { signReaderSession } from '@/lib/reader-auth/session'

const params = (slug: Array<string>) => ({ params: Promise.resolve({ slug }) })
const render = async (slug: Array<string>) => renderToStaticMarkup(await DocsPage(params(slug)))
let betaCookie = ''

beforeAll(async () => {
  vi.stubEnv('THALLY_READER_SESSION_SECRET', 's'.repeat(40))
  state.sources = {
    'src/content/guides/open.mdx': '---\ntitle: Open guide\n---\nOpen body',
    'src/content/guides/secret.mdx': `---\ntitle: Secret roadmap\ngroups: [beta]\n---\n${MARKER}`,
  }
  betaCookie = (await signReaderSession({ subject: 'u1', groups: ['beta'] }))!.token
})

beforeEach(() => {
  config.auth = { mode: 'jwt', default: 'public' }
  resetReaderAuthConfigForTests()
  state.cookie = undefined
  state.authorization = null
})

describe('document route under reader auth', () => {
  it('renders public pages for anonymous readers', async () => {
    expect(await render(['guides', 'open'])).toContain('Open body')
  })

  it('answers a restricted page exactly like a missing page', async () => {
    await expect(render(['guides', 'secret'])).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(render(['guides', 'missing'])).rejects.toThrow('NEXT_NOT_FOUND')
    expect(await generateMetadata(params(['guides', 'secret']))).toEqual({})
  })

  it('judges a document by the file it resolved, not by an id that looks open', async () => {
    await expect(render(['guides', 'alias'])).rejects.toThrow('NEXT_NOT_FOUND')
    expect(await generateMetadata(params(['guides', 'alias']))).toEqual({})
  })

  it('renders the restricted page and its metadata for a reader in the group', async () => {
    state.cookie = betaCookie
    expect(await render(['guides', 'secret'])).toContain(MARKER)
    expect(await generateMetadata(params(['guides', 'secret']))).toMatchObject({ title: expect.stringContaining('Secret roadmap') })
  })

  it('denies a reader outside the group without a sign-in hop', async () => {
    state.cookie = (await signReaderSession({ subject: 'u2', groups: ['ga'] }))!.token
    await expect(render(['guides', 'secret'])).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('sends anonymous readers on a private site to the same-origin sign-in route for missing and restricted paths alike', async () => {
    config.auth = { mode: 'jwt' }
    resetReaderAuthConfigForTests()
    await expect(render(['guides', 'secret'])).rejects.toThrow('NEXT_REDIRECT /api/reader/login?redirect=%2Fguides%2Fsecret')
    await expect(render(['guides', 'missing'])).rejects.toThrow('NEXT_REDIRECT /api/reader/login?redirect=%2Fguides%2Fmissing')
  })

  it('accepts an agent bearer token on the HTML route', async () => {
    vi.stubEnv('THALLY_READER_TOKEN_KEYS', `k1:${'t'.repeat(40)}`)
    const { mintAgentToken } = await import('@/lib/reader-auth/session')
    state.authorization = `Bearer ${(await mintAgentToken({ label: 'ci', groups: ['beta'], expiresInSeconds: 600 })).token}`
    expect(await render(['guides', 'secret'])).toContain(MARKER)
  })
})
