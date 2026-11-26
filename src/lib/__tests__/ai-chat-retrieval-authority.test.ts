/** Actual listing/index recovery must never pair published private bodies with embedded public metadata. */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeManagedContentAssets, type RuntimeSourceMap } from '../../../scripts/lib/runtime-content-files'

const state = vi.hoisted(() => ({ embedded: {} as Record<string, string> }))
const config = vi.hoisted(() => ({
  auth: { mode: 'jwt', default: 'public' },
  tabs: [{ tab: 'Docs', groups: [{ group: 'Guides', pages: ['guide', 'noindex', 'hidden', 'excluded', 'public'] }] }],
  i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] },
}))
vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => config, getDocsJsonConfigRevision: () => 1 }))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: (prefix: string) => Object.keys(state.embedded).filter((name) => name.startsWith(prefix)),
  runtimeSourceExists: (name: string) => Object.hasOwn(state.embedded, name),
  readRuntimeSource: (name: string) => state.embedded[name],
  runtimeSourceModifiedAt: () => 1,
}))
vi.mock('@/lib/i18n/request', () => ({ getEffectiveI18nConfig: async () => config.i18n }))
vi.mock('@/lib/cloud-link/client', () => ({
  getCloudServiceGrant: async () => 'test-runtime-grant',
  getCloudSiteConfig: async () => ({ entitlements: { features: { aiAnswers: true } }, siteConfig: { portable: { ai: { enabled: true } } } }),
}))

const roots: Array<string> = []
const clearFetchers: Array<() => void> = []
const sha = (body: string) => createHash('sha256').update(body).digest('hex')

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('THALLY_CONTENT_SOURCE', 'assets')
  vi.stubEnv('THALLY_CONTENT_INDEX', '')
  vi.stubEnv('THALLY_EMBEDDING_PROVIDER', 'local')
  state.embedded = Object.fromEntries(['guide', 'noindex', 'hidden', 'excluded', 'public'].map((id) => [`src/content/${id}.mdx`, `---\ntitle: Embedded ${id}\npublic: true\n---\nEmbedded stale ${id}.`]))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  clearFetchers.splice(0).forEach((clear) => clear())
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'thally-chat-authority-'))
  roots.push(root)
  const sources: RuntimeSourceMap = {
    'src/content/guide.mdx': { content: '---\ntitle: Private current guide\npublic: false\n---\nPRIVATEBODY current private answer.', modifiedAtMs: 1 },
    'src/content/noindex.mdx': { content: '---\ntitle: Noindex\nnoindex: true\n---\nNOINDEXBODY current answer.', modifiedAtMs: 1 },
    'src/content/hidden.mdx': { content: '---\ntitle: Hidden\nhidden: true\n---\nHIDDENBODY current answer.', modifiedAtMs: 1 },
    'src/content/excluded.mdx': { content: '---\ntitle: Excluded\n---\nEXCLUDEDBODY current answer.', modifiedAtMs: 1 },
    'src/content/public.mdx': { content: '---\ntitle: Current public\npublic: true\n---\nCurrent public fact.', modifiedAtMs: 1 },
    'src/content/added.mdx': { content: '---\ntitle: Added public\npublic: true\n---\nNewly published public fact.', modifiedAtMs: 1 },
    'thally-unpublished-pages.json': { content: '["excluded"]', modifiedAtMs: 1 },
  }
  const manifest = await writeManagedContentAssets(root, sources)
  const bodies = new Map(Object.entries(sources).map(([name, file]) => [name, file.content]))
  for (const descriptor of manifest.search?.shards ?? []) {
    const shard = JSON.parse(readFileSync(path.join(root, 'public/_thally/content', descriptor.path), 'utf8'))
    // This page deliberately uses canonical fallback, exercising strict parse
    // cache isolation from its earlier embedded body with the same mtime.
    delete shard.records['src/content/public.mdx']?.retrieval
    const body = JSON.stringify(shard)
    descriptor.sha256 = sha(body); descriptor.bytes = Buffer.byteLength(body)
    bodies.set(descriptor.path, body)
  }
  const index = { version: 1, pages: {
    'src/content/guide.mdx': { data: { title: 'Private current guide', public: false }, modifiedAtMs: 1 },
    'src/content/noindex.mdx': { data: { title: 'Noindex', noindex: true }, modifiedAtMs: 1 },
    'src/content/hidden.mdx': { data: { title: 'Hidden', hidden: true }, modifiedAtMs: 1 },
    'src/content/excluded.mdx': { data: { title: 'Excluded' }, modifiedAtMs: 1 },
    'src/content/public.mdx': { data: { title: 'Current public', public: true }, modifiedAtMs: 1 },
    'src/content/added.mdx': { data: { title: 'Added public', public: true }, modifiedAtMs: 1 },
  } }
  const unavailable = new Set<string>()
  const fetchAsset = vi.fn(async (url: string) => {
    if (url === '/_thally/content/manifest.json') return new Response(JSON.stringify(manifest))
    if (url === '/_thally/content/index.json') return new Response(JSON.stringify(index))
    const name = url.slice('/_thally/content/'.length).split('/').map(decodeURIComponent).join('/')
    if (unavailable.has(name)) return new Response('Unavailable', { status: 503 })
    const body = bodies.get(name)
    return new Response(body ?? '', { status: body === undefined ? 404 : 200 })
  })
  const { setContentAssetFetcher, getContentSource } = await import('@/lib/content-source')
  setContentAssetFetcher(null)
  clearFetchers.push(() => setContentAssetFetcher(null))
  return { getContentSource, restore: () => setContentAssetFetcher(fetchAsset), unavailable, bodies, fetchAsset }
}

function chatRequest() { return new Request('https://docs.example/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'public fact' }] }) }) }

describe('strict Ask AI published metadata and canonical body authority', () => {
  it('recovers actual listing/publication state and never forwards new private/noindex bodies under old embedded metadata', async () => {
    const data = await fixture()
    const docs = await import('@/data/docs')
    expect((await docs.loadDocEntries()).map(({ id }) => id)).toContain('guide')
    const { loadContentDocument } = await import('@/lib/content/document')
    expect((await loadContentDocument('public'))?.rawBody).toContain('Embedded stale public')
    const { handleCloudAiChat } = await import('@/lib/cloud-link/services')
    const forward = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Safe answer'))
    expect((await handleCloudAiChat(chatRequest())).status).toBe(503)
    expect(forward).not.toHaveBeenCalled()
    data.restore()
    data.unavailable.add('thally-unpublished-pages.json')
    expect((await handleCloudAiChat(chatRequest())).status).toBe(503)
    expect(forward).not.toHaveBeenCalled()
    data.unavailable.clear()
    const response = await handleCloudAiChat(chatRequest())
    expect(response.status).toBe(200)
    const payload = String(forward.mock.calls[0][1]?.body)
    expect(payload).toContain('Current public fact')
    expect(payload).not.toMatch(/PRIVATEBODY|NOINDEXBODY|HIDDENBODY|EXCLUDEDBODY|Embedded stale/)
    const { loadAiChatRetrievalChunks, aiChatRetrievalCacheSnapshotForTests } = await import('@/lib/ai-chat-retrieval')
    const chunks = await loadAiChatRetrievalChunks()
    expect(chunks.map(({ pageId }) => pageId)).toEqual(['public', 'added'])
    expect(chunks.map(({ text }) => text).join('\n')).toContain('Newly published public fact')
    expect(aiChatRetrievalCacheSnapshotForTests(data.getContentSource()).entries).toBe(0)
  })

  it('fails closed if a canonical body becomes unavailable after strict metadata succeeds, then recovers without embedded content', async () => {
    const data = await fixture()
    const docs = await import('@/data/docs')
    await docs.loadDocEntries()
    const { loadContentDocument } = await import('@/lib/content/document')
    await loadContentDocument('public')
    data.restore()
    data.unavailable.add('src/content/public.mdx')
    const { handleCloudAiChat } = await import('@/lib/cloud-link/services')
    const forward = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Safe answer'))
    expect((await handleCloudAiChat(chatRequest())).status).toBe(503)
    expect(forward).not.toHaveBeenCalled()
    const { aiChatRetrievalCacheSnapshotForTests } = await import('@/lib/ai-chat-retrieval')
    expect(aiChatRetrievalCacheSnapshotForTests(data.getContentSource()).entries).toBe(0)
    data.unavailable.clear()
    expect((await handleCloudAiChat(chatRequest())).status).toBe(200)
    expect(String(forward.mock.calls[0][1]?.body)).toContain('Current public fact')
    expect(String(forward.mock.calls[0][1]?.body)).not.toContain('Embedded stale')
  })

  it('returns a closed 503 for an exhausted prepared transfer and recovers without partial corpus admission', async () => {
    const data = await fixture()
    data.restore()
    data.unavailable.add('search/0000.json')
    const { handleCloudAiChat } = await import('@/lib/cloud-link/services')
    const forward = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Safe answer'))
    const failed = await handleCloudAiChat(chatRequest())
    expect(failed.status).toBe(503)
    await expect(failed.text()).resolves.toBe('Thally AI is temporarily unavailable. Please try again.')
    expect(forward).not.toHaveBeenCalled()
    const { aiChatRetrievalCacheSnapshotForTests } = await import('@/lib/ai-chat-retrieval')
    expect(aiChatRetrievalCacheSnapshotForTests(data.getContentSource()).entries).toBe(0)
    data.unavailable.clear()
    expect((await handleCloudAiChat(chatRequest())).status).toBe(200)
    const payload = String(forward.mock.calls[0][1]?.body)
    expect(payload).toContain('Current public fact')
    expect(payload).not.toMatch(/PRIVATEBODY|NOINDEXBODY|HIDDENBODY|EXCLUDEDBODY|Embedded stale/)
  })

  it('does not disguise unexpected integrity-validator failures as transient availability', async () => {
    const data = await fixture()
    data.restore()
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('Unexpected digest failure'))
    const { handleCloudAiChat } = await import('@/lib/cloud-link/services')
    const forward = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Safe answer'))
    await expect(handleCloudAiChat(chatRequest())).rejects.toThrow('Unexpected digest failure')
    expect(forward).not.toHaveBeenCalled()
    const { aiChatRetrievalCacheSnapshotForTests } = await import('@/lib/ai-chat-retrieval')
    expect(aiChatRetrievalCacheSnapshotForTests(data.getContentSource()).entries).toBe(0)
  })
})
