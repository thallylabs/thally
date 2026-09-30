/** Manual `api:` pages get a synthetic operation; `openapi:` keeps precedence. */

import { describe, expect, it, vi } from 'vitest'
import { getDocFromParams } from './get-doc'
import { getManualApiOperation } from './manual-api'

const pages = vi.hoisted(() => ({
  files: {} as Record<string, { frontmatter: Record<string, unknown>; source: string }>,
  config: { servers: ['https://httpbin.org'] as Array<string>, auth: { method: 'bearer' } as { method: string } | undefined },
}))

vi.mock('@/data/docs', () => ({
  deriveTitleFromSlug: (slug: string) => slug,
  getI18nConfig: () => ({ defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }, { code: 'de', label: 'German' }] }),
  getApiMdxConfig: () => pages.config,
}))
vi.mock('next-mdx-remote/rsc', () => ({ compileMDX: vi.fn() }))
vi.mock('@/lib/mdx-interpret', () => ({ interpretMDX: vi.fn() }))
vi.mock('@/mdx/remark', () => ({ remarkPlugins: [] }))
vi.mock('@/mdx/rehype', () => ({ rehypePlugins: [] }))
vi.mock('@/components/mdx/mdx-components', () => ({ useMDXComponents: () => ({}) }))
vi.mock('@/mdx/snippet-registry', () => ({ resolveSnippetComponent: vi.fn() }))
vi.mock('@/lib/runtime-sources', () => ({ runtimeSourceExists: () => true, readRuntimeSource: () => '' }))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'filesystem',
    exists: async (path: string) => path.replace('src/content/', '').replace('.mdx', '') in pages.files,
    read: async (path: string) => {
      const entry = pages.files[path.replace('src/content/', '').replace('.mdx', '')]
      return entry ? { content: entry.source } : null
    },
  }),
}))
vi.mock('@/generated/runtime-docs', () => ({
  runtimeDocs: new Proxy({}, {
    get: (_target, key: string) => {
      const entry = pages.files[key.replace('src/content/', '').replace('.mdx', '')]
      return entry ? { component: () => null, frontmatter: entry.frontmatter } : undefined
    },
  }),
}))

function page(id: string, frontmatter: Record<string, unknown>, body = '') {
  pages.files[id] = { frontmatter, source: `---\ntitle: T\n---\n${body}` }
}

describe('manual API pages', () => {
  it('builds a synthetic operation from api frontmatter and ParamFields', async () => {
    page('users', { title: 'Users', api: 'POST https://httpbin.org/anything/users/{id}' }, '<ParamField path="id" type="string" default="1" />\n<ParamField body="name" type="string" />')
    const doc = await getDocFromParams(['users'])
    expect(doc?.openapi).toBeUndefined()
    expect(doc?.manualApi).toMatchObject({ manualPage: 'users', method: 'POST', title: 'Users', servers: [{ url: 'https://httpbin.org' }] })
    expect(doc?.manualApi?.prefill.path).toEqual({ id: '1' })
    expect(JSON.parse(doc!.manualApi!.prefill.body!)).toEqual({ name: '' })
  })

  it('uses docs.json server and auth for path-only values', async () => {
    page('status', { title: 'Status', api: 'GET /status' })
    const doc = await getDocFromParams(['status'])
    expect(doc?.manualApi?.servers).toEqual([{ url: 'https://httpbin.org' }])
    expect(doc?.manualApi?.prefill.header.Authorization).toMatch(/^Bearer /)
  })

  it('renders a malformed api page as ordinary MDX', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    page('bad', { title: 'Bad', api: 'FETCH' })
    const doc = await getDocFromParams(['bad'])
    expect(doc?.manualApi).toBeUndefined()
    expect(doc?.openapi).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('lets openapi win when both are set, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    page('both', { title: 'Both', api: 'GET /a', openapi: 'GET /b' })
    const doc = await getDocFromParams(['both'])
    expect(doc?.openapi).toMatchObject({ method: 'GET', path: '/b' })
    expect(doc?.manualApi).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('both'))
    warn.mockRestore()
  })

  it('carries a spec prefix on openapi frontmatter', async () => {
    page('spec', { title: 'S', openapi: 'openapi-b.yaml GET /widgets/{id}' })
    expect((await getDocFromParams(['spec']))?.openapi).toMatchObject({ specRef: 'openapi-b.yaml', method: 'GET', path: '/widgets/{id}' })
  })

  it('treats an empty api key as absent without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    page('empty', { title: 'E', api: null })
    expect((await getDocFromParams(['empty']))?.manualApi).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ignores non-string api values without crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [i, api] of [42, ['GET /x'], { a: 1 }].entries()) {
      page(`n${i}`, { title: 'N', api })
      expect((await getDocFromParams([`n${i}`]))?.manualApi).toBeUndefined()
    }
    warn.mockRestore()
  })
  it('gives the Try It relay the same operation the page renders, without compiling the page', async () => {
    const body = '<ParamField path="id" type="string" default="7" />\n<ParamField query="q" type="string" />'
    const frontmatter = { title: 'Get user', api: 'GET /users/{id}', authMethod: 'bearer' }
    pages.files['relay/user'] = {
      frontmatter,
      source: `---\ntitle: Get user\napi: "GET /users/{id}"\nauthMethod: bearer\n---\n${body}`,
    }
    const rendered = (await getDocFromParams(['relay', 'user']))?.manualApi
    expect(rendered).toBeDefined()
    expect(await getManualApiOperation('relay/user')).toEqual(rendered)
    pages.files['relay/both'] = { frontmatter: {}, source: '---\napi: "GET /x"\nopenapi: "GET /x"\n---\n' }
    expect(await getManualApiOperation('relay/both')).toBeNull()
    expect(await getManualApiOperation('relay/missing')).toBeNull()
    expect(await getManualApiOperation('../relay/user')).toBeNull()
  })
})

describe('localized manual API pages', () => {
  const apiPage = (id: string, api?: string) => {
    pages.files[id] = { frontmatter: api ? { title: 'T', api } : { title: 'T' }, source: `---\ntitle: T\n${api ? `api: "${api}"\n` : ''}---\n` }
  }

  it('resolves the relay from the locale the page rendered, and the default locale without one', async () => {
    apiPage('relay/tx', 'GET https://api.example.com/users')
    apiPage('fr/relay/tx', 'GET https://api.example.com/utilisateurs')
    const rendered = (await getDocFromParams(['relay', 'tx'], 'fr'))?.manualApi
    expect(rendered).toMatchObject({ manualLocale: 'fr', path: '/utilisateurs' })
    expect(await getManualApiOperation('relay/tx', 'fr')).toEqual(rendered)
    const english = await getManualApiOperation('relay/tx')
    expect(english).toMatchObject({ path: '/users' })
    expect(english).not.toHaveProperty('manualLocale')
  })

  it('finds a translation-only api page only with its locale', async () => {
    apiPage('relay/only-fr')
    apiPage('fr/relay/only-fr', 'GET https://api.example.com/seul')
    const rendered = (await getDocFromParams(['relay', 'only-fr'], 'fr'))?.manualApi
    expect(rendered).toMatchObject({ path: '/seul' })
    expect(await getManualApiOperation('relay/only-fr', 'fr')).toEqual(rendered)
    expect(await getManualApiOperation('relay/only-fr')).toBeNull()
  })

  it('matches the rendered fallback for a configured locale without a translation file', async () => {
    apiPage('relay/fallback', 'GET https://api.example.com/users')
    const rendered = (await getDocFromParams(['relay', 'fallback'], 'de'))?.manualApi
    expect(rendered).toMatchObject({ manualLocale: 'de', path: '/users' })
    expect(await getManualApiOperation('relay/fallback', 'de')).toEqual(rendered)
  })

  it('refuses a locale that is not configured, so it cannot select a content directory', async () => {
    apiPage('guides/relay/tx', 'GET https://api.example.com/users')
    apiPage('relay/tx', 'GET https://api.example.com/users')
    expect(await getManualApiOperation('relay/tx', 'guides')).toBeNull()
  })
})

