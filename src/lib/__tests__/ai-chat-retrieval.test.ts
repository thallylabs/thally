/** Full-section retrieval must preserve canonical chunks without pinning fallback corpora. */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMdxContent } from '@thallylabs/core/markdown'
import { chunkDocument, getRelevantChunks, rankLexicalChunks, type Chunk } from '@thallylabs/core/embeddings'
import type { ContentSource } from '@/lib/content-source/types'
import type { PreparedRetrievalContent } from '@/lib/search/prepared-content-contract'

const mocks = vi.hoisted(() => ({ source: vi.fn(), listing: vi.fn(), document: vi.fn(), provider: vi.fn(), relevant: vi.fn(), policy: vi.fn(), index: vi.fn(), publication: vi.fn() }))
vi.mock('@/lib/content-source', () => ({ getContentSource: mocks.source }))
vi.mock('@/lib/search/register-doc-source', () => ({ loadListedDocEntries: mocks.listing }))
vi.mock('@/lib/content/document', async (original) => ({ ...await original<typeof import('@/lib/content/document')>(), loadContentDocument: mocks.document }))
vi.mock('@/lib/i18n/request', () => ({ getEffectiveI18nConfig: async () => ({ defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'fr' }] }) }))
vi.mock('@/lib/reader-auth/config', () => ({ getReaderAuthConfig: mocks.policy }))
vi.mock('@/lib/content-index', () => ({ loadContentIndex: mocks.index }))
vi.mock('@/data/docs', () => ({ ensureAuthoritativeDocPublication: mocks.publication }))
vi.mock('@thallylabs/core/embeddings', async (original) => ({ ...await original<typeof import('@thallylabs/core/embeddings')>(), getRelevantChunks: mocks.relevant, getEmbeddingProvider: mocks.provider }))

import { aiChatRetrievalCacheSnapshotForTests, getAiChatRelevantChunks, loadAiChatRetrievalChunks } from '../ai-chat-retrieval'

const entry = (id = 'guide', title = 'Current guide', href = '/guide') => ({ id, title, href })
function projection(body: string): PreparedRetrievalContent {
  return { version: 1, sourceHash: createHash('sha256').update(body).digest('hex'), sections: parseMdxContent(body, 'agents').sections }
}
function source(records: Record<string, PreparedRetrievalContent | undefined>): ContentSource {
  return {
    kind: 'assets', exists: vi.fn(async (path) => Object.hasOwn(records, path)),
    retrievalContent: vi.fn(async (path) => records[path]),
    read: async () => null, list: async () => Object.keys(records), modifiedAt: async () => 0,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.provider.mockReturnValue({ id: 'local-hash-v3', embed: vi.fn() })
  mocks.listing.mockResolvedValue([entry()])
  mocks.policy.mockReturnValue({ isEnabled: false, isMisconfigured: false, defaultVisibility: 'public', sessionEpoch: 0 })
  mocks.document.mockResolvedValue(null)
  mocks.relevant.mockResolvedValue([])
  mocks.index.mockResolvedValue({ version: 1, pages: {} })
  mocks.publication.mockResolvedValue(undefined)
})

describe('managed Ask AI full-section retrieval', () => {
  it('keeps exact canonical chunks, full code and late facts without changing BM25 options', async () => {
    const body = `# Product\n\n<Human>excluded</Human>\n\n<Agent>agent-visible</Agent>\n\n## Transfers\n\n${'ordinary prose '.repeat(250)} latefactneedle\n\n### Code\n\n\`\`\`ts title="exact sample"\n${'const value = 1;\n'.repeat(180)}// code-tail-needle\n\`\`\``
    const prepared = projection(body)
    const active = source({ 'src/content/guide.mdx': prepared })
    mocks.source.mockReturnValue(active)
    const chunks = await loadAiChatRetrievalChunks()
    expect(chunks).toEqual(chunkDocument({ pageId: 'guide', title: 'Current guide', href: '/guide', sections: parseMdxContent(body, 'agents').sections }))
    expect(chunks.some(({ text }) => text.includes('latefactneedle'))).toBe(true)
    expect(chunks.some(({ text }) => text.includes('code-tail-needle'))).toBe(true)
    expect(chunks.every(({ text }) => !text.includes('excluded'))).toBe(true)
    const options = { k: 3, tokenBudget: 4000, maxPerPage: 2, context: 'previous transfers question' }
    expect(await getAiChatRelevantChunks(' latefactneedle ', options)).toEqual(rankLexicalChunks('latefactneedle', chunks, options))
    expect(mocks.document).not.toHaveBeenCalled()
    expect(mocks.provider().embed).not.toHaveBeenCalled()
    expect(getRelevantChunks).not.toHaveBeenCalled()
  })

  it('coalesces concurrent corpora and reuses only fully prepared results', async () => {
    let resolve!: () => void
    const gate = new Promise<void>((yes) => { resolve = yes })
    const records = { 'src/content/guide.mdx': projection('Full guide'), 'src/content/second.mdx': projection('Second guide') }
    const active = source(records)
    active.retrievalContent = vi.fn(async (path) => { await gate; return records[path as keyof typeof records] })
    mocks.source.mockReturnValue(active)
    mocks.listing.mockResolvedValue([entry(), entry('second', 'Second', '/second')])
    const pending = [loadAiChatRetrievalChunks(), loadAiChatRetrievalChunks(), loadAiChatRetrievalChunks()]
    await vi.waitFor(() => expect(active.retrievalContent).toHaveBeenCalledTimes(2))
    resolve()
    const [first, second, third] = await Promise.all(pending)
    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(await loadAiChatRetrievalChunks()).toBe(first)
    expect(active.retrievalContent).toHaveBeenCalledTimes(2)
    expect(aiChatRetrievalCacheSnapshotForTests(active)).toMatchObject({ entries: 1 })
  })

  it('never caches a corpus with canonical fallback and can use prepared assets after recovery', async () => {
    const active = source({ 'src/content/guide.mdx': undefined })
    mocks.source.mockReturnValue(active)
    mocks.document.mockResolvedValue({ content: parseMdxContent('Temporary embedded fallback', 'agents') })
    expect((await loadAiChatRetrievalChunks())[0].text).toContain('embedded fallback')
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
    await loadAiChatRetrievalChunks()
    expect(mocks.document).toHaveBeenCalledTimes(2)
    vi.mocked(active.retrievalContent!).mockResolvedValue(projection('Authoritative prepared content'))
    expect((await loadAiChatRetrievalChunks())[0].text).toContain('Authoritative prepared content')
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(1)
  })

  it('rejects failed prepared reads, evicts the failed corpus, and recovers without partial caching', async () => {
    const active = source({ 'src/content/guide.mdx': projection('Recovered') })
    mocks.source.mockReturnValue(active)
    vi.mocked(active.retrievalContent!).mockRejectedValueOnce(new Error('Transient asset failure'))
    await expect(loadAiChatRetrievalChunks()).rejects.toThrow('Transient asset failure')
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
    expect((await loadAiChatRetrievalChunks())[0].text).toContain('Recovered')
    expect(mocks.document).not.toHaveBeenCalled()
  })

  it('uses current listing order, metadata, access identity and content-source identity', async () => {
    const first = source({ 'src/content/guide.mdx': projection('First release'), 'src/content/other.mdx': projection('Other page'), 'src/content/private.mdx': projection('Must not leak') })
    mocks.source.mockReturnValue(first)
    await loadAiChatRetrievalChunks()
    mocks.listing.mockResolvedValue([entry('other', 'Renamed', '/current/other'), entry('guide', 'New title', '/current/guide')])
    const reordered = await loadAiChatRetrievalChunks()
    expect(reordered.map(({ pageId, title, href }) => [pageId, title, href])).toEqual([['other', 'Renamed', '/current/other'], ['guide', 'New title', '/current/guide']])
    expect(first.retrievalContent).not.toHaveBeenCalledWith('src/content/private.mdx')
    mocks.policy.mockReturnValue({ isEnabled: true, isMisconfigured: false, defaultVisibility: 'private', sessionEpoch: 1 })
    mocks.listing.mockResolvedValue([entry('guide')])
    expect((await loadAiChatRetrievalChunks()).map(({ pageId }) => pageId)).toEqual(['guide'])
    expect(aiChatRetrievalCacheSnapshotForTests(first).entries).toBeLessThanOrEqual(2)
    const second = source({ 'src/content/guide.mdx': projection('Second release') })
    mocks.source.mockReturnValue(second)
    expect((await loadAiChatRetrievalChunks())[0].text).toContain('Second release')
  })

  it('preserves physical translation precedence and never substitutes a prepared base page for a legacy translation', async () => {
    const active = source({ 'src/content/fr/guide/index.mdx': undefined, 'src/content/guide.mdx': projection('Base page') })
    mocks.source.mockReturnValue(active)
    mocks.listing.mockResolvedValue([entry('guide', 'Guide français', '/fr/guide')])
    mocks.document.mockResolvedValue({ content: parseMdxContent('Canonical translation', 'agents') })
    const chunks = await loadAiChatRetrievalChunks('fr')
    expect(chunks[0]).toMatchObject({ title: 'Guide français', href: '/fr/guide' })
    expect(chunks[0].text).toContain('Canonical translation')
    expect(active.retrievalContent).toHaveBeenCalledExactlyOnceWith('src/content/fr/guide/index.mdx')
    expect(mocks.document).toHaveBeenCalledWith('guide', 'fr', { publishedOnly: true })
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
  })

  it('rechecks physical precedence when an assets binding appears after an embedded exists fallback', async () => {
    let restored = false
    const active = source({})
    active.exists = vi.fn(async (path) => path === 'src/content/guide.mdx' || (restored && path === 'src/content/fr/guide.mdx'))
    active.retrievalContent = vi.fn(async (path) => { restored = true; return projection(path.includes('/fr/') ? 'Restored French' : 'Base') })
    mocks.source.mockReturnValue(active)
    expect((await loadAiChatRetrievalChunks('fr'))[0].text).toContain('Restored French')
  })

  it('rebuilds a restored authoritative listing and never admits it under an earlier fallback listing key', async () => {
    const active = source({ 'src/content/guide.mdx': projection('Guide'), 'src/content/added.mdx': projection('Newly published') })
    mocks.source.mockReturnValue(active)
    mocks.listing.mockResolvedValue([entry(), entry('added', 'Added', '/added')]).mockResolvedValueOnce([entry()])
    const chunks = await loadAiChatRetrievalChunks()
    expect(chunks.map(({ pageId }) => pageId)).toEqual(['guide', 'added'])
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
    expect(await loadAiChatRetrievalChunks()).toEqual(chunks)
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(1)
  })

  it('bounds retained payload and refuses empty/unverified or oversized corpora', async () => {
    const sections = [{ id: '', title: '', depth: 0, headingPath: [], code: [], text: 'payload '.repeat(20_000) }]
    const records = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/content/page-${i}.mdx`, { version: 1 as const, sourceHash: 'a'.repeat(64), sections }]))
    const active = source(records)
    mocks.source.mockReturnValue(active)
    mocks.listing.mockResolvedValue([])
    expect(await loadAiChatRetrievalChunks()).toEqual([])
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
    mocks.listing.mockResolvedValue(Array.from({ length: 30 }, (_, i) => entry(`page-${i}`, `Page ${i}`, `/page-${i}`)))
    expect(await loadAiChatRetrievalChunks()).toHaveLength(30)
    expect(aiChatRetrievalCacheSnapshotForTests(active)).toEqual({ entries: 0, bytes: 0 })
  })

  it('retains at most two distinct listing variants and refetches an evicted corpus', async () => {
    const active = source({ 'src/content/guide.mdx': projection('Full guide') })
    mocks.source.mockReturnValue(active)
    for (const title of ['First', 'Second', 'Third', 'First']) {
      mocks.listing.mockResolvedValue([entry('guide', title)])
      expect((await loadAiChatRetrievalChunks())[0].title).toBe(title)
      expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBeLessThanOrEqual(2)
      expect(aiChatRetrievalCacheSnapshotForTests(active).bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    }
    expect(active.retrievalContent).toHaveBeenCalledTimes(4)
  })

  it('delegates filesystem and hosted providers to the existing retrieval behavior', async () => {
    const sentinel = [{ chunk: {} as Chunk, score: 1 }]
    mocks.relevant.mockResolvedValue(sentinel)
    mocks.source.mockReturnValue({ kind: 'filesystem' })
    expect(await getAiChatRelevantChunks('question', { context: 'prior' })).toBe(sentinel)
    mocks.source.mockReturnValue(source({}))
    mocks.provider.mockReturnValue({ id: 'openai:configured-model' })
    expect(await getAiChatRelevantChunks('question', { k: 3 })).toBe(sentinel)
    expect(mocks.relevant).toHaveBeenLastCalledWith('question', { k: 3 })
    expect(mocks.listing).not.toHaveBeenCalled()
  })

  it('fails closed before listing or bodies when published metadata cannot be proven', async () => {
    const active = source({ 'src/content/guide.mdx': projection('Published body') })
    mocks.source.mockReturnValue(active)
    mocks.index.mockResolvedValue(null)
    await expect(loadAiChatRetrievalChunks()).rejects.toMatchObject({ code: 'THALLY_PUBLISHED_CONTENT_UNAVAILABLE' })
    expect(mocks.listing).not.toHaveBeenCalled()
    expect(active.retrievalContent).not.toHaveBeenCalled()
    expect(mocks.document).not.toHaveBeenCalled()
    expect(aiChatRetrievalCacheSnapshotForTests(active).entries).toBe(0)
  })
})
