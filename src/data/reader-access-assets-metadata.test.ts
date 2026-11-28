/** Source-only metadata is shared by every projection, scoped to immutable source identity. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentIndex } from '@/lib/content-index'
const state = vi.hoisted(() => ({
  files: {} as Record<string, string>, index: null as ContentIndex | null,
  source: {} as object, reads: [] as string[], fail: '', list: vi.fn(), churn: false,
  loadIndex: vi.fn(), onIndexRead: null as (() => void) | null,
  config: { auth: { mode: 'jwt', default: 'private' }, tabs: [{ tab: 'Docs', pages: ['introduction', 'products/one', 'products/ciam', 'integration/quickstart', 'integration/signals', 'integration/journeys', 'reference/broken', 'missing'] }], i18n: { defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'fr' }] } },
}))
vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => state.config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  runtimeSourcePageUpdate: () => undefined,
  runtimeSourceExists: (path: string) => process.env.THALLY_CONTENT_BUILD === '1' && path in state.files,
  listRuntimeSources: () => process.env.THALLY_CONTENT_BUILD === '1' ? Object.keys(state.files) : [],
  readRuntimeSource: (path: string) => {
    if (process.env.THALLY_CONTENT_BUILD === '1' && path in state.files) return state.files[path]
    throw new Error('Compiled content is not authority')
  },
}))
vi.mock('@/lib/content-index', () => ({
  getContentIndex: () => { const index = state.index; state.onIndexRead?.(); return index },
  loadContentIndex: () => state.loadIndex(),
}))
vi.mock('@/lib/content-source', () => ({ getContentSource: () => state.churn ? { ...state.source } : state.source }))
const page = (title: string, access = '') => `---\ntitle: ${title}\n${access}\n---\nBody`
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('THALLY_CONTENT_SOURCE', 'assets')
  vi.stubEnv('THALLY_CONTENT_BUILD', '')
  state.index = null; state.fail = ''; state.reads = []; state.config.auth.default = 'private'
  state.churn = false
  state.onIndexRead = null
  state.loadIndex.mockReset().mockImplementation(async () => state.index)
  state.files = {
    'src/content/introduction.mdx': page('Public overview', 'public: true') + '\n[Start integration](/integration/quickstart)',
    'src/content/products/one.mdx': page('Product one', 'public: true'),
    'src/content/products/ciam.mdx': page('Product CIAM', 'public: true'),
    'src/content/integration/quickstart.mdx': page('PRIVATE QUICKSTART TITLE', 'public: false'),
    'src/content/integration/signals.mdx': page('PRIVATE GROUP TITLE', 'groups: [engineers]\npublic: true'),
    'src/content/integration/journeys.mdx': 'Plain body without frontmatter',
    'src/content/reference/broken.mdx': '---\ntitle: [unclosed\n---\nPRIVATE BROKEN',
    'src/content/orphan/index.mdx': page('Public orphan', 'public: true'),
    'src/content/fr/integration/quickstart.mdx': page('Translation cannot open primary', 'public: true'),
    'src/content/fr/products/one.mdx': page('Restricted translation', 'groups: [beta]'),
  }
  const read = async (path: string) => {
    state.reads.push(path)
    if (path === state.fail) throw new Error('Published source unavailable')
    return path in state.files ? { content: state.files[path], modifiedAtMs: 1 } : null
  }
  state.list = vi.fn(async () => Object.keys(state.files))
  state.source = { kind: 'assets', read, readPublished: read, list: state.list }
  await import('@/lib/content-source')
})
afterEach(() => vi.unstubAllEnvs())
const reader = { isAuthenticated: true, source: 'session' as const, groups: [] as string[] }
describe('shared authoritative source metadata', () => {
  it('closes a churning source identity promptly instead of recursively retrying forever', async () => {
    state.churn = true
    const docs = await import('./docs')
    await expect(docs.loadDocEntries()).rejects.toMatchObject({ code: 'THALLY_PUBLISHED_CONTENT_UNAVAILABLE' })
    expect(docs.getDocEntries()).toEqual([])
    state.churn = false
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toContain('introduction')
  })
  it('uses actual authored build metadata without letting build-prepared caches authorize serving without ASSETS', async () => {
    vi.stubEnv('THALLY_CONTENT_BUILD', '1')
    state.fail = 'thally-unpublished-pages.json'
    const docs = await import('./docs')
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toEqual(['introduction', 'products/one', 'products/ciam', 'orphan'])
    expect(JSON.stringify(await docs.loadSidebarCollections())).not.toContain('PRIVATE')
    vi.stubEnv('THALLY_CONTENT_BUILD', '')
    expect(docs.getDocEntries()).toEqual([])
    await expect(docs.loadDocEntries()).rejects.toThrow('Published source unavailable')
    state.fail = ''
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toEqual(['introduction', 'products/one', 'products/ciam', 'orphan'])
  })
  it('closes synchronous cold views, then shares one physical metadata read across listings/access/locales/groups', async () => {
    const docs = await import('./docs')
    expect(docs.getDocEntries()).toEqual([])
    expect(JSON.stringify(docs.getSidebarCollections())).not.toContain('integration/quickstart')
    const [entries, sidebar, access, groups] = await Promise.all([
      docs.loadDocEntries(), docs.loadSidebarCollections(), docs.loadPageAccess('integration/quickstart'), docs.loadReferencedReaderGroups(),
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['introduction', 'products/one', 'products/ciam', 'orphan'])
    expect(JSON.stringify(sidebar)).not.toMatch(/PRIVATE|integration\/quickstart|missing/)
    expect(access.isPublic).toBe(false)
    expect([...groups].sort()).toEqual(['beta', 'engineers'])
    for (const path of Object.keys(state.files)) expect(state.reads.filter((read) => read === path)).toHaveLength(1)
    expect(await docs.canReaderViewPage('integration/quickstart', undefined, 'fr')).toBe(false)
    expect(await docs.canReaderViewPage('products/one', undefined, 'fr')).toBe(false)
    expect(await docs.canReaderViewPage('products/one', { ...reader, groups: ['beta'] }, 'fr')).toBe(true)
  })
  it('separates reader visibility caches while retaining ordinary default and malformed semantics', async () => {
    const docs = await import('./docs')
    expect((await docs.loadDocEntries(reader)).map((entry) => entry.id)).toContain('integration/journeys')
    expect((await docs.loadDocEntries(reader)).map((entry) => entry.id)).not.toContain('integration/signals')
    expect((await docs.loadDocEntries({ ...reader, groups: ['engineers'] })).map((entry) => entry.id)).toContain('integration/signals')
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).not.toContain('integration/quickstart')
    expect(await docs.canReaderViewPage('reference/broken', reader)).toBe(false)
    expect(await docs.canReaderViewPage('integration/journeys')).toBe(false)
    state.config.auth = { mode: 'jwt', default: 'public' }
    const { resetReaderAuthConfigForTests } = await import('@/lib/reader-auth/config')
    resetReaderAuthConfigForTests()
    expect(await docs.canReaderViewPage('integration/journeys')).toBe(true)
  })
  it('never accepts fallback list emptiness without publication authority, and retries after recovery', async () => {
    state.files = {}; state.fail = 'thally-unpublished-pages.json'
    const docs = await import('./docs')
    await expect(docs.loadDocEntries()).rejects.toThrow('Published source unavailable')
    expect(state.list).not.toHaveBeenCalled()
    state.fail = ''
    expect(await docs.loadDocEntries()).toEqual([])
  })
  it('drops partial reads rather than caching an open or manufactured empty result', async () => {
    state.fail = 'src/content/integration/quickstart.mdx'
    const docs = await import('./docs')
    await expect(docs.loadDocEntries()).rejects.toThrow('Published source unavailable')
    expect(docs.getDocEntries()).toEqual([])
    state.fail = ''
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toContain('introduction')
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).not.toContain('integration/quickstart')
  })
  it('recovered real index supersedes fallback metadata and invalidates navigation and groups', async () => {
    const docs = await import('./docs')
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toContain('products/one')
    state.index = { version: 1, pages: { 'src/content/introduction.mdx': { data: { title: 'New index title', public: true }, modifiedAtMs: 2 } } }
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).toEqual(['introduction'])
    expect(JSON.stringify(await docs.loadSidebarCollections())).toContain('New index title')
    expect(await docs.loadReferencedReaderGroups()).toEqual(new Set())
  })
  it('never lets a late fallback completion overwrite an index recovered by another request', async () => {
    let release!: () => void
    let started!: () => void
    const startedRead = new Promise<void>((resolve) => { started = resolve })
    const delayed = new Promise<void>((resolve) => { release = resolve })
    const source = state.source as { readPublished: (path: string) => Promise<unknown> }
    const read = source.readPublished
    source.readPublished = async (path) => {
      if (path === 'src/content/introduction.mdx') { started(); await delayed }
      return read(path)
    }
    const docs = await import('./docs')
    const fallback = docs.loadDocEntries()
    await startedRead
    state.index = { version: 1, pages: { 'src/content/introduction.mdx': { data: { title: 'Recovered during fallback', public: true }, modifiedAtMs: 2 } } }
    expect((await docs.loadDocEntries()).map((entry) => entry.title)).toEqual(['Recovered during fallback'])
    release()
    expect((await fallback).map((entry) => entry.title)).toEqual(['Recovered during fallback'])
    expect((await docs.loadDocEntries()).map((entry) => entry.title)).toEqual(['Recovered during fallback'])
  })
  it('uses current metadata when access-only recovery runs between preparation and entry-cache installation', async () => {
    let startA!: () => void, releaseA!: () => void, startB!: () => void, recoverB!: (index: ContentIndex) => void
    const aStarted = new Promise<void>((resolve) => { startA = resolve })
    const aGate = new Promise<void>((resolve) => { releaseA = resolve })
    const bStarted = new Promise<void>((resolve) => { startB = resolve })
    const bIndex = new Promise<ContentIndex>((resolve) => { recoverB = resolve })
    state.loadIndex.mockResolvedValueOnce(null).mockImplementationOnce(() => { startB(); return bIndex })
    const source = state.source as { readPublished: (path: string) => Promise<unknown> }
    const read = source.readPublished
    source.readPublished = async (path) => {
      if (path === 'src/content/introduction.mdx') { startA(); await aGate }
      return read(path)
    }
    const docs = await import('./docs')
    const listing = docs.loadDocEntries()
    await aStarted
    // This request only hydrates access metadata; it never builds an entry list.
    const access = docs.loadPageAccess('products/one')
    await bStarted
    state.onIndexRead = () => {
      state.onIndexRead = null
      state.index = { version: 1, pages: { 'src/content/introduction.mdx': { data: { title: 'Recovered before entry installation', public: true }, modifiedAtMs: 2 } } }
      recoverB(state.index)
    }
    releaseA()
    expect((await listing).map((entry) => entry.title)).toEqual(['Recovered before entry installation'])
    expect((await access).isMalformed).toBe(true)
    expect((await docs.loadDocEntries()).map((entry) => entry.title)).toEqual(['Recovered before entry installation'])
  })
  it('keeps direct-file precedence and source identity when a new release replaces a fallback', async () => {
    state.files['src/content/orphan.mdx'] = page('Private direct file', 'public: false')
    const docs = await import('./docs')
    expect((await docs.loadDocEntries()).map((entry) => entry.id)).not.toContain('orphan')
    const next = { 'src/content/introduction.mdx': { content: page('Replacement release', 'public: true'), modifiedAtMs: 3 } }
    state.source = { kind: 'assets', read: async () => null, readPublished: async (path: string) => next[path as keyof typeof next] ?? null, list: async () => Object.keys(next) }
    expect((await docs.loadDocEntries()).map((entry) => entry.title)).toEqual(['Replacement release'])
    expect(JSON.stringify(await docs.loadSidebarCollections())).not.toContain('Public overview')
  })
})
