/** Build and cache embeddings from the canonical local or remote page source. */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadContentDocument } from '../content/index.js'
import { resolveDocEntriesAsync } from '../doc-source.js'
import { chunkDocument } from './chunk.js'
import { getEmbeddingProvider } from './provider.js'
import type { Chunk, EmbeddedChunk, EmbeddingIndex, EmbeddingProvider } from './types.js'

// Resolved per call, not at import time, so processes that chdir before
// building (tests, CLIs invoked from another directory) hit the cache that
// belongs to the site they are building.
function cacheDir(): string {
  return path.join(process.cwd(), '.thally', 'embeddings')
}

// Cache entries key on the page's raw body, so parser/chunker changes do NOT
// change the key. Bump this whenever chunk *derivation* changes (parsing,
// chunking, text extraction) so stale vectors are discarded — otherwise a
// pipeline fix never reaches pages whose source didn't change.
const CACHE_SCHEMA_VERSION = 2

interface PageCacheEntry {
  hash: string
  chunks: Array<EmbeddedChunk>
}

interface DiskCache {
  version?: number
  provider: string
  dimensions: number
  pages: Record<string, PageCacheEntry>
}

function cacheFile(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9._-]/gi, '_')
  return path.join(cacheDir(), `${safe}.json`)
}

function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function readDiskCache(providerId: string): DiskCache | null {
  try {
    const raw = fs.readFileSync(cacheFile(providerId), 'utf8')
    return JSON.parse(raw) as DiskCache
  } catch {
    return null
  }
}

function writeDiskCache(cache: DiskCache) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    fs.writeFileSync(cacheFile(cache.provider), JSON.stringify(cache))
  } catch {
    // Read-only filesystem (e.g. some serverless runtimes) — in-memory index
    // still works; persistence is a best-effort optimization.
  }
}

export interface PageSource {
  pageId: string
  href: string
  title: string
  /** Source body used both for chunking and content-hash cache keying. */
  rawBody: string
  chunks: Array<Chunk>
}

/** Default enumeration of all doc pages via the content engine. */
async function collectPageSources(): Promise<Array<PageSource>> {
  const sources = await Promise.all(
    (await resolveDocEntriesAsync()).map(async (entry): Promise<PageSource | null> => {
      const document = await loadContentDocument(entry.id)
      if (!document) return null
      const chunks = chunkDocument({
        pageId: entry.id,
        href: entry.href,
        title: entry.title,
        sections: document.content.sections,
      })
      if (chunks.length === 0) return null
      return {
        pageId: entry.id,
        href: entry.href,
        title: entry.title,
        rawBody: document.rawBody,
        chunks,
      }
    }),
  )
  return sources.filter((source): source is PageSource => source !== null)
}

export interface BuildOptions {
  /** Inject page sources (used by tests); defaults to the content engine. */
  sources?: Array<PageSource>
  provider?: EmbeddingProvider
  /** Skip reading/writing the disk cache (used by tests). */
  noCache?: boolean
}

/**
 * Build the embedding index with incremental, content-hash-keyed caching:
 * unchanged pages reuse their previously computed vectors, so only edited
 * pages are re-embedded.
 */
export async function buildEmbeddingIndex(options: BuildOptions = {}): Promise<EmbeddingIndex> {
  const provider = options.provider ?? getEmbeddingProvider()
  const sources = options.sources ?? (await collectPageSources())
  const disk = options.noCache ? null : readDiskCache(provider.id)
  // Reuse only caches from the same provider, vector space, and chunk-derivation
  // schema; anything else (including a malformed file) re-embeds from scratch.
  const isReusable =
    disk != null &&
    disk.provider === provider.id &&
    disk.dimensions === provider.dimensions &&
    disk.version === CACHE_SCHEMA_VERSION &&
    typeof disk.pages === 'object' &&
    disk.pages != null
  const reusable = new Map<string, PageCacheEntry>(isReusable ? Object.entries(disk.pages) : [])

  const nextPages: Record<string, PageCacheEntry> = {}
  const allChunks: Array<EmbeddedChunk> = []
  let reusedPages = 0

  // Pages whose content changed (or are new) get embedded in one batched call.
  const toEmbed: Array<{ pageId: string; hash: string; chunks: Array<Chunk> }> = []

  for (const source of sources) {
    const hash = contentHash(source.rawBody)
    const cached = reusable.get(source.pageId)
    if (cached && cached.hash === hash) {
      nextPages[source.pageId] = cached
      allChunks.push(...cached.chunks)
      reusedPages += 1
    } else {
      toEmbed.push({ pageId: source.pageId, hash, chunks: source.chunks })
    }
  }

  if (toEmbed.length > 0) {
    const flatChunks = toEmbed.flatMap((page) => page.chunks)
    const vectors = await provider.embed(flatChunks.map((chunk) => chunk.text))

    let cursor = 0
    for (const page of toEmbed) {
      const embedded: Array<EmbeddedChunk> = page.chunks.map((chunk) => ({
        ...chunk,
        embedding: vectors[cursor++],
      }))
      nextPages[page.pageId] = { hash: page.hash, chunks: embedded }
      allChunks.push(...embedded)
    }
  }

  const index: EmbeddingIndex = {
    provider: provider.id,
    dimensions: provider.dimensions,
    createdAt: new Date().toISOString(),
    chunks: allChunks,
  }

  if (!options.noCache) {
    writeDiskCache({
      version: CACHE_SCHEMA_VERSION,
      provider: provider.id,
      dimensions: provider.dimensions,
      pages: nextPages,
    })
  }

  return { ...index, ...{ reusedPages, embeddedPages: toEmbed.length } } as EmbeddingIndex & {
    reusedPages: number
    embeddedPages: number
  }
}

let memoized: EmbeddingIndex | null = null

/** Lazily build (and memoize) the embedding index for the running process. */
export async function getEmbeddingIndex(): Promise<EmbeddingIndex> {
  if (memoized) return memoized
  memoized = await buildEmbeddingIndex()
  return memoized
}

/** Test hook to drop the in-memory index. */
export function resetEmbeddingIndex() {
  memoized = null
}
