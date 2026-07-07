import { getEmbeddingIndex } from '@/lib/embeddings/index-store'
import { getEmbeddingProvider } from '@/lib/embeddings/provider'
import type { EmbeddedChunk, EmbeddingVector, RetrievalResult } from '@/lib/embeddings/types'

function dot(a: EmbeddingVector, b: EmbeddingVector): number {
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) sum += a[i] * b[i]
  return sum
}

function cosine(a: EmbeddingVector, b: EmbeddingVector): number {
  let normA = 0
  let normB = 0
  for (const value of a) normA += value * value
  for (const value of b) normB += value * value
  if (normA === 0 || normB === 0) return 0
  return dot(a, b) / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface RankOptions {
  /** Max number of chunks to return. */
  k?: number
  /** Max cumulative tokens across returned chunks. */
  tokenBudget?: number
  /** Drop chunks scoring at or below this threshold. */
  minScore?: number
}

const DEFAULT_K = 6
const DEFAULT_TOKEN_BUDGET = 1500

/**
 * Rank pre-embedded chunks against a query vector, returning the top results
 * within both a count (k) and a cumulative token budget.
 */
export function rankChunks(
  queryEmbedding: EmbeddingVector,
  chunks: Array<EmbeddedChunk>,
  options: RankOptions = {},
): Array<RetrievalResult> {
  const k = options.k ?? DEFAULT_K
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  const minScore = options.minScore ?? 0

  const scored = chunks
    .map((chunk) => ({ chunk, score: cosine(queryEmbedding, chunk.embedding) }))
    .filter((result) => result.score > minScore)
    .sort((a, b) => b.score - a.score)

  const results: Array<RetrievalResult> = []
  let usedTokens = 0

  for (const { chunk, score } of scored) {
    if (results.length >= k) break
    if (usedTokens + chunk.tokens > tokenBudget && results.length > 0) continue
    const { embedding: _embedding, ...rest } = chunk
    results.push({ chunk: rest, score })
    usedTokens += chunk.tokens
  }

  return results
}

/**
 * Typed retrieval helper: embed the query with the active provider and return
 * the most relevant chunks within the token budget. Shared by search, chat,
 * and agent-context endpoints.
 */
export async function getRelevantChunks(
  query: string,
  options: RankOptions = {},
): Promise<Array<RetrievalResult>> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const provider = getEmbeddingProvider()
  const index = await getEmbeddingIndex()
  const [queryEmbedding] = await provider.embed([trimmed])

  return rankChunks(queryEmbedding, index.chunks, options)
}
