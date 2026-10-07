/**
 * Reader access under the assets content source WITHOUT a content index
 * (local `THALLY_CONTENT_SOURCE=assets` builds, or an index that failed to
 * load). The compiled maps are empty there, so access must be read from the
 * same content source the page body is rendered from: open pages stay open,
 * restricted pages stay closed, and ids with no file are closed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ files: {} as Record<string, string>, reads: [] as Array<string> }))
const config = vi.hoisted(() => ({
  auth: { mode: 'jwt', default: 'public' },
  i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }] },
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: ['introduction', 'guides/secret'] }] }],
}))

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
// Assets builds embed no authored sources.
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => [],
  readRuntimeSource: () => { throw new Error('ENOENT') },
  runtimeSourceExists: () => false,
  runtimeSourceModifiedAt: () => 0,
}))
// No index binding, and the ASSETS index is absent.
vi.mock('@/lib/content-index', () => ({ getContentIndex: () => null, loadContentIndex: async () => null, isIndexedContentPath: () => true }))
vi.mock('@/lib/content-source', () => ({
  isRemoteContentSource: () => true,
  getContentSource: () => ({
    kind: 'assets',
    exists: async (path: string) => path in state.files,
    read: async (path: string) => {
      state.reads.push(path)
      return path in state.files ? { content: state.files[path] } : null
    },
  }),
}))

import { canReaderViewPage, loadPageAccess } from '@/data/docs'
import { resetReaderAuthConfigForTests } from '@/lib/reader-auth/config'
import type { ReaderContext } from '@/lib/reader-auth/access'

const beta: ReaderContext = { isAuthenticated: true, groups: ['beta'], source: 'session' }

beforeAll(() => {
  vi.stubEnv('THALLY_CONTENT_SOURCE', 'assets')
  state.files = {
    'src/content/introduction.mdx': '---\ntitle: Introduction\n---\nWelcome',
    'src/content/guides/secret.mdx': '---\ntitle: Secret\ngroups: [beta]\n---\nTOPSECRET',
    'src/content/guides/broken.mdx': '---\ntitle: [unclosed\n---\nBody',
    'src/content/guides/open.mdx': '---\ntitle: Open\n---\nOpen',
    'src/content/fr/guides/open.mdx': '---\ntitle: Ouvert\ngroups: [beta]\n---\nRestreint',
  }
})
afterAll(() => vi.unstubAllEnvs())
beforeEach(() => {
  resetReaderAuthConfigForTests()
  state.reads = []
})

describe('assets source without a content index', () => {
  it('keeps open pages open, reading access from the content source', async () => {
    expect(await canReaderViewPage('introduction')).toBe(true)
    expect(state.reads).toContain('src/content/introduction.mdx')
  })

  it('keeps restricted pages closed to anonymous readers and open to the group', async () => {
    expect(await canReaderViewPage('guides/secret')).toBe(false)
    expect(await canReaderViewPage('guides/secret', beta)).toBe(true)
  })

  it('closes ids with no file, file-suffixed aliases, unsafe ids, and unparseable frontmatter', async () => {
    for (const id of ['guides/missing', 'guides/secret.mdx', 'guides/secret.MDX', 'guides/secret/index.mdx', 'guides/secret%2Emdx']) {
      expect(await canReaderViewPage(id, beta)).toBe(false)
    }
    for (const id of ['../secret', 'guides/../secret', 'guides//secret', 'guides\\secret']) {
      expect((await loadPageAccess(id)).isMalformed).toBe(true)
    }
    expect((await loadPageAccess('guides/broken')).isMalformed).toBe(true)
  })

  it('merges a translation with its primary page, and refuses unsafe locales', async () => {
    expect(await canReaderViewPage('guides/open', undefined, 'fr')).toBe(false)
    expect(await canReaderViewPage('guides/open', beta, 'fr')).toBe(true)
    expect(await canReaderViewPage('guides/secret', undefined, 'fr')).toBe(false)
    expect((await loadPageAccess('guides/open', '../x')).isMalformed).toBe(true)
  })
})
