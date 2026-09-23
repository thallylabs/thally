/**
 * Chunk retrieval for AI answers.
 *
 * Ranking strategy depends on the embedding provider:
 * - The zero-config local provider is a hashed bag of words with no term
 *   rarity, so it is not used for ranking at all; BM25 (see `lexical.ts`) is.
 * - A hosted semantic provider captures paraphrase that BM25 misses but misses
 *   exact identifiers BM25 nails, so the two rankings are fused with
 *   reciprocal rank fusion.
 *
 * `rankChunks` keeps its dense-only contract for callers that already hold a
 * query vector.
 */

import { getEmbeddingIndex } from './index-store.js'
import { getLexicalIndex, lexicalQueryTerms, scoreLexical } from './lexical.js'
import { getEmbeddingProvider, localHashProvider } from './provider.js'
import type { Chunk, EmbeddedChunk, EmbeddingIndex, EmbeddingVector, RetrievalResult } from './types.js'

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
  /**
   * Cap on chunks taken from one page, so a single long page cannot fill every
   * slot and crowd out a second page that holds the rest of the answer.
   */
  maxPerPage?: number
  /**
   * Earlier conversation text used to resolve follow-up questions. Its words
   * count for less than the question's own words; lexical ranking only.
   */
  context?: string
}

const DEFAULT_K = 6
const DEFAULT_TOKEN_BUDGET = 1500

// Standard reciprocal-rank-fusion damping: large enough that rank 1 vs 2 in
// one list does not dominate agreement between both lists.
const RRF_K = 60

function stripEmbedding(chunk: Chunk | EmbeddedChunk): Chunk {
  if (!('embedding' in chunk)) return chunk
  const { embedding: _embedding, ...rest } = chunk
  return rest
}

/** Apply the score floor, count, per-page, and token-budget limits in rank order. */
function selectWithinBudget(
  scored: Array<{ chunk: Chunk | EmbeddedChunk; score: number }>,
  options: RankOptions,
): Array<RetrievalResult> {
  const k = options.k ?? DEFAULT_K
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  const minScore = options.minScore ?? 0
  const maxPerPage = options.maxPerPage ?? Number.POSITIVE_INFINITY

  const results: Array<RetrievalResult> = []
  const perPage = new Map<string, number>()
  let usedTokens = 0

  for (const { chunk, score } of scored) {
    if (results.length >= k) break
    if (score <= minScore) continue
    if ((perPage.get(chunk.pageId) ?? 0) >= maxPerPage) continue
    if (usedTokens + chunk.tokens > tokenBudget && results.length > 0) continue
    results.push({ chunk: stripEmbedding(chunk), score })
    perPage.set(chunk.pageId, (perPage.get(chunk.pageId) ?? 0) + 1)
    usedTokens += chunk.tokens
  }

  return results
}

/**
 * Rank pre-embedded chunks against a query vector, returning the top results
 * within both a count (k) and a cumulative token budget.
 */
export function rankChunks(
  queryEmbedding: EmbeddingVector,
  chunks: Array<EmbeddedChunk>,
  options: RankOptions = {},
): Array<RetrievalResult> {
  const scored = chunks
    .map((chunk) => ({ chunk, score: cosine(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
  return selectWithinBudget(scored, options)
}

/**
 * Rank an index's chunks for a question. With no query vector the ranking is
 * BM25 alone; with one, BM25 and cosine rankings are fused by reciprocal rank.
 * Fused scores are normalized to [0, 1]: a chunk ranked first by both lists
 * scores exactly 1, and one ranked first by a single list scores 0.5.
 */
export function rankIndexedChunks(
  query: string,
  index: EmbeddingIndex,
  queryEmbedding: EmbeddingVector | null,
  options: RankOptions = {},
): Array<RetrievalResult> {
  const chunks = index.chunks
  const lexicalScores = scoreLexical(
    getLexicalIndex(chunks),
    lexicalQueryTerms(query, options.context),
  )

  if (!queryEmbedding) {
    const scored = chunks
      .map((chunk, position) => ({ chunk, score: lexicalScores[position] }))
      .sort((a, b) => b.score - a.score)
    return selectWithinBudget(scored, options)
  }

  const fused = new Array<number>(chunks.length).fill(0)
  const addRanking = (scores: Array<number>) => {
    scores
      .map((score, position) => ({ score, position }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .forEach(({ position }, rank) => {
        fused[position] += 1 / (RRF_K + rank + 1)
      })
  }
  addRanking(lexicalScores)
  addRanking(chunks.map((chunk) => cosine(queryEmbedding, chunk.embedding)))

  const best = 2 / (RRF_K + 1)
  const scored = chunks
    .map((chunk, position) => ({ chunk, score: fused[position] / best }))
    .sort((a, b) => b.score - a.score)
  return selectWithinBudget(scored, options)
}

/**
 * Typed retrieval helper: return the most relevant chunks within the token
 * budget for a chat question.
 */
export async function getRelevantChunks(
  query: string,
  options: RankOptions = {},
): Promise<Array<RetrievalResult>> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const provider = getEmbeddingProvider()
  const index = await getEmbeddingIndex()
  // The local provider's vectors are a strictly weaker lexical signal than
  // BM25; fusing them in only adds noise, so skip embedding the query.
  const queryEmbedding = provider.id === localHashProvider.id
    ? null
    : (await provider.embed([trimmed]))[0]

  return rankIndexedChunks(trimmed, index, queryEmbedding, options)
}
