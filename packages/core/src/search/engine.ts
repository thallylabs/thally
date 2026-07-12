import { create, insertMultiple, search } from '@orama/orama'
import type { AnyOrama } from '@orama/orama'
import { buildSearchCorpus } from './corpus.js'
import type { SearchRecord } from './corpus.js'
import { getEmbeddingIndex } from '../embeddings/index-store.js'
import { getEmbeddingProvider } from '../embeddings/provider.js'
import type { EmbeddingVector } from '../embeddings/types.js'

export type SearchMode = 'fulltext' | 'hybrid'

export interface SearchHit {
  pageId: string
  title: string
  description: string
  href: string
  score: number
  snippet: string
}

interface IndexedRecord extends SearchRecord {
  embedding: EmbeddingVector
}

interface SearchEngine {
  db: AnyOrama
  dimensions: number
}

function meanPool(vectors: Array<EmbeddingVector>, dimensions: number): EmbeddingVector {
  const acc = new Array<number>(dimensions).fill(0)
  for (const vector of vectors) {
    for (let i = 0; i < dimensions && i < vector.length; i += 1) acc[i] += vector[i]
  }
  let sumSquares = 0
  for (let i = 0; i < dimensions; i += 1) {
    acc[i] /= vectors.length
    sumSquares += acc[i] * acc[i]
  }
  if (sumSquares === 0) return acc
  const norm = Math.sqrt(sumSquares)
  return acc.map((value) => value / norm)
}

async function pageEmbeddings(records: Array<SearchRecord>, dimensions: number): Promise<Map<string, EmbeddingVector>> {
  const map = new Map<string, EmbeddingVector>()
  try {
    const index = await getEmbeddingIndex()
    const byPage = new Map<string, Array<EmbeddingVector>>()
    for (const chunk of index.chunks) {
      const list = byPage.get(chunk.pageId) ?? []
      list.push(chunk.embedding)
      byPage.set(chunk.pageId, list)
    }
    for (const [pageId, vectors] of byPage) {
      if (vectors.length) map.set(pageId, meanPool(vectors, dimensions))
    }
  } catch {
    // fall through to on-the-fly embedding below
  }

  const missing = records.filter((record) => !map.has(record.pageId))
  if (missing.length) {
    const provider = getEmbeddingProvider()
    const vectors = await provider.embed(
      missing.map((record) => `${record.title}\n${record.description}\n${record.body}`),
    )
    missing.forEach((record, i) => map.set(record.pageId, vectors[i]))
  }
  return map
}

let enginePromise: Promise<SearchEngine> | null = null

async function buildEngine(): Promise<SearchEngine> {
  const provider = getEmbeddingProvider()
  const dimensions = provider.dimensions
  const records = buildSearchCorpus()
  const embeddings = await pageEmbeddings(records, dimensions)

  const db = create({
    schema: {
      pageId: 'string',
      title: 'string',
      description: 'string',
      headings: 'string',
      body: 'string',
      keywords: 'string',
      href: 'string',
      embedding: `vector[${dimensions}]`,
    },
  }) as AnyOrama

  const indexed: Array<IndexedRecord> = records.map((record) => ({
    ...record,
    embedding: embeddings.get(record.pageId) ?? new Array<number>(dimensions).fill(0),
  }))

  await insertMultiple(db, indexed as never)
  return { db, dimensions }
}

export function getSearchEngine(): Promise<SearchEngine> {
  if (!enginePromise) enginePromise = buildEngine()
  return enginePromise
}

export function resetSearchEngine() {
  enginePromise = null
}

function buildSnippet(body: string, query: string): string {
  if (!body) return ''
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2)
  const lower = body.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1) {
      at = found
      break
    }
  }
  if (at === -1) return `${body.slice(0, 160).trim()}…`
  const start = Math.max(0, at - 60)
  const end = Math.min(body.length, at + 120)
  return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`
}

export async function searchDocs(
  query: string,
  options: { limit?: number; mode?: SearchMode } = {},
): Promise<Array<SearchHit>> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const limit = options.limit ?? 8
  const mode = options.mode ?? 'hybrid'
  const engine = await getSearchEngine()

  const searchParams: Record<string, unknown> = {
    term: trimmed,
    properties: ['title', 'description', 'headings', 'body', 'keywords'],
    boost: { title: 3, headings: 2, description: 1.5, keywords: 1.5 },
    tolerance: 1,
    limit,
  }

  if (mode === 'hybrid') {
    const provider = getEmbeddingProvider()
    const [queryEmbedding] = await provider.embed([trimmed])
    searchParams.mode = 'hybrid'
    searchParams.vector = { value: queryEmbedding, property: 'embedding' }
    searchParams.similarity = 0.2
  } else {
    searchParams.mode = 'fulltext'
  }

  const results = await search(engine.db, searchParams as never)

  return results.hits.map((hit) => {
    const doc = hit.document as unknown as SearchRecord
    return {
      pageId: doc.pageId,
      title: doc.title,
      description: doc.description,
      href: doc.href,
      score: hit.score,
      snippet: buildSnippet(doc.body, trimmed),
    }
  })
}
