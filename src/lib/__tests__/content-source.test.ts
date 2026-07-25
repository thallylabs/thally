/**
 * ContentSource contract tests: env selection, filesystem parity with the
 * pre-abstraction runtime-sources API, the assets provider's manifest
 * behavior, and its fail-soft fallback to build-embedded content.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_MANIFEST_PATH,
  createAssetsContentSource,
  getContentSource,
  getContentSourceKind,
  resetContentSourceForTests,
  setContentAssetFetcher,
  type ContentManifest,
  type ContentSource,
} from '@/lib/content-source'
import {
  listRuntimeSources,
  readRuntimeSource,
  runtimeSourceExists,
  runtimeSourceModifiedAt,
} from '@/lib/runtime-sources'
import { getContentDocument, loadContentDocument } from '@/lib/content'

const savedEnv = process.env.THALLY_CONTENT_SOURCE

function restoreEnv(): void {
  if (savedEnv === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = savedEnv
}

beforeEach(() => {
  delete process.env.THALLY_CONTENT_SOURCE
  resetContentSourceForTests()
  setContentAssetFetcher(null)
})

afterEach(() => {
  restoreEnv()
  resetContentSourceForTests()
  setContentAssetFetcher(null)
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

interface FakeAssets {
  fetcher: (assetPath: string) => Promise<Response>
  calls: Array<string>
}

function fakeAssets(manifest: ContentManifest, files: Record<string, string>): FakeAssets {
  const calls: Array<string> = []
  return {
    calls,
    fetcher: async (assetPath: string) => {
      calls.push(assetPath)
      if (assetPath === CONTENT_MANIFEST_PATH) return jsonResponse(manifest)
      const projectPath = decodeURIComponent(assetPath.replace('/_thally/content/', ''))
      const body = files[projectPath]
      if (body === undefined) return new Response('not found', { status: 404 })
      return new Response(body, { status: 200 })
    },
  }
}

const manifest: ContentManifest = {
  version: 1,
  files: {
    'src/content/introduction.mdx': { modifiedAtMs: 1111 },
    'src/content/guides/setup.mdx': { modifiedAtMs: 2222 },
    'snippets/note.mdx': { modifiedAtMs: 3333 },
    'docs.json': { modifiedAtMs: 4444 },
  },
}

const files: Record<string, string> = {
  'src/content/introduction.mdx': '---\ntitle: Fresh Intro\n---\n\nPublished body.\n',
  'src/content/guides/setup.mdx': '# Setup\n',
  'snippets/note.mdx': 'A snippet.\n',
  'docs.json': '{"tabs":[]}',
}

// Stub fallback that records delegation so fail-soft behavior is observable.
function stubFallback(): ContentSource & { reads: Array<string> } {
  const reads: Array<string> = []
  return {
    kind: 'filesystem',
    reads,
    async exists() {
      return true
    },
    async read(projectPath: string) {
      reads.push(projectPath)
      return { content: 'embedded fallback', modifiedAtMs: 1 }
    },
    async modifiedAt() {
      return 1
    },
    async list() {
      return ['embedded/list']
    },
  }
}

describe('content source selection', () => {
  it('defaults to filesystem when the env var is unset', () => {
    expect(getContentSourceKind()).toBe('filesystem')
    expect(getContentSource().kind).toBe('filesystem')
  })

  it('selects the assets source when THALLY_CONTENT_SOURCE=assets', () => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    resetContentSourceForTests()
    expect(getContentSource().kind).toBe('assets')
  })

  it('normalizes case and whitespace', () => {
    process.env.THALLY_CONTENT_SOURCE = '  ASSETS '
    resetContentSourceForTests()
    expect(getContentSourceKind()).toBe('assets')
  })

  it('falls back to filesystem on unknown values instead of failing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    process.env.THALLY_CONTENT_SOURCE = 'r2'
    resetContentSourceForTests()
    expect(getContentSourceKind()).toBe('filesystem')
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('filesystem source parity (regression: default behavior unchanged)', () => {
  it('mirrors runtime-sources byte-for-byte', async () => {
    const source = getContentSource()
    const [firstPath] = listRuntimeSources('src/content')
    expect(firstPath).toBeDefined()

    expect(await source.exists(firstPath)).toBe(runtimeSourceExists(firstPath))
    expect((await source.read(firstPath))?.content).toBe(readRuntimeSource(firstPath))
    expect(await source.modifiedAt(firstPath)).toBe(runtimeSourceModifiedAt(firstPath))
    expect(await source.list('src/content')).toEqual(listRuntimeSources('src/content'))
  })

  it('reports missing files the same way', async () => {
    const source = getContentSource()
    expect(await source.exists('src/content/definitely-missing.mdx')).toBe(false)
    expect(await source.read('src/content/definitely-missing.mdx')).toBeNull()
  })
})

describe('assets source', () => {
  it('answers exists/list/modifiedAt from the manifest', async () => {
    const assets = fakeAssets(manifest, files)
    const source = createAssetsContentSource(stubFallback(), () => assets.fetcher)

    expect(await source.exists('src/content/introduction.mdx')).toBe(true)
    expect(await source.exists('src/content/missing.mdx')).toBe(false)
    expect(await source.modifiedAt('src/content/guides/setup.mdx')).toBe(2222)
    expect(await source.list('src/content')).toEqual([
      'src/content/introduction.mdx',
      'src/content/guides/setup.mdx',
    ])
    expect(await source.list('snippets')).toEqual(['snippets/note.mdx'])
    // One manifest fetch answered everything above.
    expect(assets.calls).toEqual([CONTENT_MANIFEST_PATH])
  })

  it('reads file bytes and caches them for the isolate lifetime', async () => {
    const assets = fakeAssets(manifest, files)
    const source = createAssetsContentSource(stubFallback(), () => assets.fetcher)

    const first = await source.read('src/content/introduction.mdx')
    const second = await source.read('src/content/introduction.mdx')
    expect(first?.content).toBe(files['src/content/introduction.mdx'])
    expect(first?.modifiedAtMs).toBe(1111)
    expect(second?.content).toBe(first?.content)
    // Manifest once + the file once — the second read hit the cache.
    expect(assets.calls.filter((c) => c !== CONTENT_MANIFEST_PATH)).toHaveLength(1)
  })

  it('returns null for files absent from the manifest without fetching', async () => {
    const assets = fakeAssets(manifest, files)
    const source = createAssetsContentSource(stubFallback(), () => assets.fetcher)

    expect(await source.read('src/content/missing.mdx')).toBeNull()
    expect(assets.calls).toEqual([CONTENT_MANIFEST_PATH])
  })

  it('rejects traversing and absolute paths outright', async () => {
    const assets = fakeAssets(manifest, files)
    const source = createAssetsContentSource(stubFallback(), () => assets.fetcher)

    expect(await source.exists('../secrets')).toBe(false)
    expect(await source.read('/etc/passwd')).toBeNull()
    expect(await source.read('src/content/../../escape.mdx')).toBeNull()
    expect(assets.calls).toEqual([])
  })

  it('treats a manifest/asset mismatch as missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const assets = fakeAssets(manifest, {}) // manifest lists files, asset set has none
    const source = createAssetsContentSource(stubFallback(), () => assets.fetcher)

    expect(await source.read('src/content/introduction.mdx')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('falls back to embedded content when the manifest cannot be fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fallback = stubFallback()
    const source = createAssetsContentSource(fallback, () => async () => new Response('boom', { status: 500 }))

    expect((await source.read('src/content/introduction.mdx'))?.content).toBe('embedded fallback')
    expect(await source.list('src/content')).toEqual(['embedded/list'])
    expect(fallback.reads).toContain('src/content/introduction.mdx')
    // The warning fires once, not per operation.
    expect(warn).toHaveBeenCalledOnce()
  })

  it('retries a file read after a transient fetch failure (no permanent 404 pinning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const assets = fakeAssets(manifest, files)
    let failNextFileFetch = true
    const source = createAssetsContentSource(stubFallback(), () => async (assetPath: string) => {
      if (failNextFileFetch && assetPath !== CONTENT_MANIFEST_PATH) {
        failNextFileFetch = false
        throw new Error('network blip')
      }
      return assets.fetcher(assetPath)
    })

    // First read hits the transient failure and reports the file missing…
    expect(await source.read('src/content/introduction.mdx')).toBeNull()
    // …but the failure is not cached: the next read fetches again and wins.
    expect((await source.read('src/content/introduction.mdx'))?.content).toBe(
      files['src/content/introduction.mdx'],
    )
    expect(warn).toHaveBeenCalled()
  })

  it('retries the manifest after a transient fetch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fallback = stubFallback()
    const assets = fakeAssets(manifest, files)
    let failNextManifestFetch = true
    const source = createAssetsContentSource(fallback, () => async (assetPath: string) => {
      if (failNextManifestFetch && assetPath === CONTENT_MANIFEST_PATH) {
        failNextManifestFetch = false
        throw new Error('network blip')
      }
      return assets.fetcher(assetPath)
    })

    // First read falls back to embedded content, second reaches the assets.
    expect((await source.read('src/content/introduction.mdx'))?.content).toBe('embedded fallback')
    expect((await source.read('src/content/introduction.mdx'))?.content).toBe(
      files['src/content/introduction.mdx'],
    )
  })

  it('falls back when no fetcher is available, then recovers once one appears', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fallback = stubFallback()
    const assets = fakeAssets(manifest, files)
    let available = false
    const source = createAssetsContentSource(fallback, () => (available ? assets.fetcher : null))

    expect((await source.read('src/content/introduction.mdx'))?.content).toBe('embedded fallback')

    // The Cloudflare context appears after runtime init — later reads must
    // not be poisoned by the earlier absence.
    available = true
    expect((await source.read('src/content/guides/setup.mdx'))?.content).toBe(files['src/content/guides/setup.mdx'])
  })
})

describe('loadContentDocument', () => {
  it('matches the sync reader under the default filesystem source', async () => {
    const [firstPath] = listRuntimeSources('src/content').filter((p) => p.endsWith('.mdx'))
    expect(firstPath).toBeDefined()
    const pageId = firstPath
      .slice('src/content/'.length, -'.mdx'.length)
      .replace(/\/index$/, '')

    const sync = getContentDocument(pageId)
    const loaded = await loadContentDocument(pageId)
    expect(loaded).not.toBeNull()
    expect(loaded?.rawBody).toBe(sync?.rawBody)
    expect(loaded?.frontmatter).toEqual(sync?.frontmatter)
  })

  it('serves published bytes under the assets source', async () => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    resetContentSourceForTests()
    const assets = fakeAssets(manifest, files)
    setContentAssetFetcher(assets.fetcher)

    const document = await loadContentDocument('introduction')
    expect(document?.frontmatter.title).toBe('Fresh Intro')
    expect(document?.rawBody).toContain('Published body.')
  })

  it('returns null for unknown pages under the assets source', async () => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    resetContentSourceForTests()
    const assets = fakeAssets(manifest, files)
    setContentAssetFetcher(assets.fetcher)

    expect(await loadContentDocument('no/such/page')).toBeNull()
  })
})
