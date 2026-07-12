import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getContentDocument } from '../content/index.js'
import { resolveDocEntries } from '../doc-source.js'
import { chunkDocument } from './chunk.js'
import { getEmbeddingProvider } from './provider.js'
import type { Chunk, EmbeddedChunk, EmbeddingIndex, EmbeddingProvider } from './types.js'

const CACHE_DIR = path.join(process.cwd(), '.thally', 'embeddings')

interface PageCacheEntry {
  hash: string
  chunks: Array<EmbeddedChunk>
}

interface DiskCache {
  provider: string
  dimensions: number
  pages: Record<string, PageCacheEntry>
}

function cacheFile(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9._-]/gi, '_')
  return path.join(CACHE_DIR, `${safe}.json`)
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
    fs.mkdirSync(CACHE_DIR, { recursive: true })
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
function collectPageSources(): Array<PageSource> {
  const sources: Array<PageSource> = []
  for (const entry of resolveDocEntries()) {
    const document = getContentDocument(entry.id)
    if (!document) continue
    const chunks = chunkDocument({
      pageId: entry.id,
      href: entry.href,
      title: entry.title,
      sections: document.content.sections,
    })
    if (chunks.length === 0) continue
    sources.push({ pageId: entry.id, href: entry.href, title: entry.title, rawBody: document.rawBody, chunks })
  }
  return sources
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
  const sources = options.sources ?? collectPageSources()
  const disk = options.noCache ? null : readDiskCache(provider.id)
  const reusable = new Map<string, PageCacheEntry>(
    disk && disk.provider === provider.id ? Object.entries(disk.pages) : [],
  )

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
    writeDiskCache({ provider: provider.id, dimensions: provider.dimensions, pages: nextPages })
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
