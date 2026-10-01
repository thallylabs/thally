/** Manual `api:` pages get a synthetic operation; `openapi:` keeps precedence. */

import { describe, expect, it, vi } from 'vitest'
import { getDocFromParams } from './get-doc'
import { getManualApiOperation } from './manual-api'

const pages = vi.hoisted(() => ({
  files: {} as Record<string, { frontmatter: Record<string, unknown>; source: string }>,
  touched: [] as Array<string>,
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
    exists: async (path: string) => {
      pages.touched.push(path)
      return Object.hasOwn(pages.files, path.replace('src/content/', '').replace('.mdx', ''))
    },
    read: async (path: string) => {
      pages.touched.push(path)
      const key = path.replace('src/content/', '').replace('.mdx', '')
      const entry = Object.hasOwn(pages.files, key) ? pages.files[key] : undefined
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
  it('declares the JSON media type for a body on both the rendered page and the relay', async () => {
    pages.files['relay/create'] = {
      frontmatter: { title: 'Create', api: 'POST /users' },
      source: '---\ntitle: Create\napi: "POST /users"\n---\n<ParamField body="name" type="string" />',
    }
    const rendered = (await getDocFromParams(['relay', 'create']))?.manualApi
    expect(rendered?.prefill.header['Content-Type']).toBe('application/json')
    expect((await getManualApiOperation('relay/create'))?.prefill.header['Content-Type']).toBe('application/json')
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

  describe('a translation cannot redirect the playground', () => {
    const withAuth = (id: string, api: string | undefined, authMethod?: string) => {
      pages.files[id] = {
        frontmatter: { title: 'T', ...(api ? { api } : {}), ...(authMethod ? { authMethod } : {}) },
        source: `---\ntitle: T\n${api ? `api: "${api}"\n` : ''}${authMethod ? `authMethod: ${authMethod}\n` : ''}---\n`,
      }
    }
    const both = async (id: string) => {
      const rendered = (await getDocFromParams(id.split('/'), 'fr'))?.manualApi
      expect(await getManualApiOperation(id, 'fr')).toEqual(rendered)
      return rendered
    }

    it('allows a path difference on the same origin', async () => {
      withAuth('tr/same', 'GET https://api.example.com/users')
      withAuth('fr/tr/same', 'GET https://api.example.com/utilisateurs')
      expect(await both('tr/same')).toMatchObject({ path: '/utilisateurs', servers: [{ url: 'https://api.example.com' }] })
      withAuth('tr/path', 'GET /users')
      withAuth('fr/tr/path', 'GET /utilisateurs')
      expect(await both('tr/path')).toMatchObject({ path: '/utilisateurs', servers: [{ url: 'https://httpbin.org' }] })
    })

    it('falls back to the primary api in the render and the relay when the origin differs, without echoing values', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      withAuth('tr/host', 'GET https://api.example.com/users')
      withAuth('fr/tr/host', 'GET https://evil.example/users')
      expect(await both('tr/host')).toMatchObject({ path: '/users', servers: [{ url: 'https://api.example.com' }] })
      // A path-only translation of an absolute primary is a different origin unless docs.json names the same one.
      withAuth('tr/rel', 'GET https://api.example.com/users')
      withAuth('fr/tr/rel', 'GET /users')
      expect(await both('tr/rel')).toMatchObject({ servers: [{ url: 'https://api.example.com' }] })
      expect(warn).toHaveBeenCalled()
      expect(warn.mock.calls.flat().join(' ')).not.toContain('evil.example')
      warn.mockRestore()
    })

    it('falls back to the primary authMethod when the translation changes it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      withAuth('tr/auth', 'GET /users', 'none')
      withAuth('fr/tr/auth', 'GET /utilisateurs', 'bearer')
      expect((await both('tr/auth'))?.prefill.header).toEqual({})
      withAuth('tr/auth2', 'GET /users')
      withAuth('fr/tr/auth2', 'GET /users', 'none')
      expect((await both('tr/auth2'))?.prefill.header.Authorization).toMatch(/^Bearer /)
      warn.mockRestore()
    })

    it('keeps a translation-only api page working', async () => {
      withAuth('tr/only', undefined)
      withAuth('fr/tr/only', 'POST https://other.example/seul', 'bearer')
      expect(await both('tr/only')).toMatchObject({ path: '/seul', servers: [{ url: 'https://other.example' }] })
    })
  })

  it('refuses a locale that is not configured, so it cannot select a content directory', async () => {
    apiPage('guides/relay/tx', 'GET https://api.example.com/users')
    apiPage('relay/tx', 'GET https://api.example.com/users')
    expect(await getManualApiOperation('relay/tx', 'guides')).toBeNull()
  })
})


describe('hostile locale and page ids reaching the relay lookup', () => {
  const seed = () => {
    for (const id of ['relay/tx', 'fr/relay/tx', 'secret']) {
      pages.files[id] = { frontmatter: { title: 'T', api: 'GET https://api.example.com/users' }, source: '---\ntitle: T\napi: "GET https://api.example.com/users"\n---\n' }
    }
    pages.touched.length = 0
  }
  const contained = () => {
    for (const path of pages.touched) {
      expect(path).toMatch(/^src\/content\/[^\\\0]*$/)
      expect(path.split('/')).not.toContain('..')
    }
  }

  const locales: Array<unknown> = [
    '../fr', '..%2Ffr', '%2e%2e%2f', '%252e%252e%252f', '..\\', 'fr/../..', 'fr%00', 'fr\u0000', '/etc/passwd', 'C:\\x',
    '\uFF46\uFF52', 'F\u0052', 'FR', 'Fr', '\u0131', 'f\u0131', '', ' fr', 'fr ', 'fr\n', '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString',
    'x'.repeat(200_000), ['fr'], { toString: () => 'fr' }, { code: 'fr' }, null, 0, true,
  ]
  it.each(locales.map((value, index) => [index, value]))('refuses locale #%s', async (_index, locale) => {
    seed()
    expect(await getManualApiOperation('relay/tx', locale as string)).toBeNull()
    contained()
  })

  const pageIds = [
    '../secret', '..%2Fsecret', '%2e%2e%2fsecret', '%252e%252e%252fsecret', '..\\secret', 'relay/../secret', 'relay/tx%00', 'relay/tx\u0000',
    '/etc/passwd', 'C:\\x', '\uFF52elay/tx', '', '/', '//', '.', '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'x/__proto__', 'x'.repeat(200_000),
  ]
  it.each(pageIds.map((value, index) => [index, value]))('refuses page id #%s with and without a locale', async (_index, id) => {
    seed()
    for (const locale of [undefined, 'fr']) {
      expect(await getManualApiOperation(id, locale)).toBeNull()
    }
    contained()
  })

  it('does not decode percent escapes into traversal', async () => {
    seed()
    expect(await getManualApiOperation('relay%2Ftx')).toBeNull()
    expect(pages.touched).toEqual(['src/content/relay%2Ftx.mdx', 'src/content/relay%2Ftx/index.mdx'])
  })

  it('still resolves a configured locale and the default locale code', async () => {
    seed()
    expect(await getManualApiOperation('relay/tx', 'fr')).not.toBeNull()
    expect(await getManualApiOperation('relay/tx', 'en')).not.toBeNull()
  })

  it('takes the locale only from the argument: a configured-locale first segment is not a page id', async () => {
    seed()
    expect(await getManualApiOperation('fr/relay/tx')).toBeNull()
    expect(await getManualApiOperation('fr/relay/tx', 'fr')).toBeNull()
    expect(await getManualApiOperation('en/relay/tx')).toBeNull()
    expect(await getManualApiOperation('FR/relay/tx')).toBeNull()
    expect(await getManualApiOperation('relay/tx', 'fr')).not.toBeNull()
  })

  it('treats a locale-looking first segment that is not configured as an ordinary directory', async () => {
    seed()
    pages.files['de-x/page'] = { frontmatter: {}, source: '---\ntitle: T\napi: "GET https://api.example.com/d"\n---\n' }
    pages.files['xx/page'] = pages.files['de-x/page']
    // `de` is configured in this file's mock but `xx` is not: it is just a folder.
    expect(await getManualApiOperation('xx/page')).toMatchObject({ path: '/d' })
    expect(await getManualApiOperation('de-x/page')).toMatchObject({ path: '/d' })
    expect(await getManualApiOperation('de/page')).toBeNull()
  })
})
