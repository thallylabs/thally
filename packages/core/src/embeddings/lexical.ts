/**
 * BM25 lexical ranking over retrieval chunks.
 *
 * The zero-config embedding provider is a hashed bag of words: it has no notion
 * of how rare a word is, so a product name that appears on every page ("How do
 * I create tables with Thally?") outweighs the one word that identifies the
 * answer. BM25 fixes exactly that failure with inverse document frequency,
 * saturating term frequency, and length normalization, and needs no model or
 * network. It is the primary retriever when no hosted embedding provider is
 * configured, and one half of the hybrid ranking when one is.
 *
 * Invariants:
 * - Index and query text go through the same `lexicalTerms` pipeline, so
 *   stemming can never disagree between the two sides.
 * - The index is derived purely from the chunk array and memoized per array,
 *   so it is built once per process alongside the embedding index.
 */

import { STOPWORDS } from './provider.js'
import type { Chunk } from './types.js'

// Standard BM25 constants. k1 saturates repeated terms quickly (docs pages
// repeat their topic word a lot); b normalizes by chunk length.
const K1 = 1.2
const B = 0.75

// Where a word appears says a lot about what a chunk is for: a word in the
// section heading or page title names the topic, while body prose mentions
// many things in passing. Chunk text already carries its heading path once.
const TITLE_WEIGHT = 2
const HEADING_WEIGHT = 2

// Earlier conversation turns help resolve follow-ups ("how do I do that?")
// but must not drown out the words of the question actually being asked.
const CONTEXT_TERM_WEIGHT = 0.5

// Question scaffolding that the embedding stoplist keeps (it predates this
// ranker and its vectors are cached by provider id, so it cannot change).
const QUERY_STOPWORDS = new Set([
  'i', 'me', 'should', 'would', 'could', 'about', 'any', 'some', 'also', 'just',
  'need', 'want', 'way', 'there', 'please', 'possible',
])

/**
 * Plural folding only ("tables" -> "table", "libraries" -> "library"), in the
 * style of the classic S-stemmer. Questions and headings disagree on number far
 * more often than on tense, and stripping "-ed"/"-ing" as well measurably hurt
 * ranking on real docs by merging unrelated words ("settings" with "set",
 * "embed" with "emb").
 */
export function stemTerm(term: string): string {
  if (term.length <= 3 || /^\d+$/.test(term)) return term
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`
  if (/(?:ss|sh|ch|x|z)es$/.test(term)) return term.slice(0, -2)
  if (term.endsWith('s') && !/(?:ss|us|is)$/.test(term)) return term.slice(0, -1)
  return term
}

/** Tokenize, drop function words, and stem: the one pipeline for index and query. */
export function lexicalTerms(text: string, extraStopwords?: ReadonlySet<string>): Array<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g)
  if (!matches) return []
  const terms: Array<string> = []
  for (const token of matches) {
    if (token.length < 2 || STOPWORDS.has(token) || extraStopwords?.has(token)) continue
    terms.push(stemTerm(token))
  }
  return terms
}

/** A chunk that contains a term, with the term's field-weighted frequency. */
interface Posting {
  position: number
  frequency: number
}

/**
 * Inverted BM25 index: scoring touches only the chunks that contain a query
 * term, so cost tracks matches rather than corpus size times question length.
 */
export interface LexicalIndex {
  postings: Map<string, Array<Posting>>
  /** Field-weighted term count per chunk, order-aligned with the input. */
  lengths: Array<number>
  averageLength: number
}

function addTerms(target: Map<string, number>, terms: Array<string>, weight: number): number {
  for (const term of terms) target.set(term, (target.get(term) ?? 0) + weight)
  return terms.length * weight
}

/** Build BM25 statistics for a chunk array (positions align with the input). */
export function buildLexicalIndex(chunks: ReadonlyArray<Chunk>): LexicalIndex {
  const postings = new Map<string, Array<Posting>>()
  let totalLength = 0
  const lengths = chunks.map((chunk, position) => {
    const termFrequency = new Map<string, number>()
    let length = addTerms(termFrequency, lexicalTerms(chunk.text), 1)
    length += addTerms(termFrequency, lexicalTerms(chunk.headingPath.join(' ')), HEADING_WEIGHT)
    length += addTerms(termFrequency, lexicalTerms(chunk.title), TITLE_WEIGHT)
    for (const [term, frequency] of termFrequency) {
      const list = postings.get(term)
      if (list) list.push({ position, frequency })
      else postings.set(term, [{ position, frequency }])
    }
    totalLength += length
    return length
  })
  return {
    postings,
    lengths,
    averageLength: lengths.length ? totalLength / lengths.length : 0,
  }
}

const memoizedIndexes = new WeakMap<ReadonlyArray<Chunk>, LexicalIndex>()

/** Memoized per chunk array, so the embedding index's chunks are indexed once. */
export function getLexicalIndex(chunks: ReadonlyArray<Chunk>): LexicalIndex {
  let index = memoizedIndexes.get(chunks)
  if (!index) {
    index = buildLexicalIndex(chunks)
    memoizedIndexes.set(chunks, index)
  }
  return index
}

/** Weighted query terms: the question at full weight, earlier turns at half. */
export function lexicalQueryTerms(query: string, context?: string): Map<string, number> {
  const weights = new Map<string, number>()
  for (const term of lexicalTerms(context ?? '', QUERY_STOPWORDS)) {
    weights.set(term, CONTEXT_TERM_WEIGHT)
  }
  // Repeating a word in the question ("Thally ... Thally") is phrasing, not
  // emphasis, so each question term counts once at full weight.
  for (const term of lexicalTerms(query, QUERY_STOPWORDS)) weights.set(term, 1)
  return weights
}

function inverseDocumentFrequency(index: LexicalIndex, term: string): number {
  const total = index.lengths.length
  const frequency = index.postings.get(term)?.length ?? 0
  return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))
}

/**
 * Score every chunk against the query. Scores are normalized to [0, 1) as the
 * share of the query's total evidence a chunk matches, so a question about a
 * word the site never mentions scores low everywhere instead of promoting
 * whatever matched the filler.
 */
export function scoreLexical(
  index: LexicalIndex,
  query: Map<string, number>,
): Array<number> {
  const scores = new Array<number>(index.lengths.length).fill(0)
  let maximum = 0
  for (const [term, weight] of query) {
    const idf = inverseDocumentFrequency(index, term)
    maximum += weight * idf * (K1 + 1)
    for (const { position, frequency } of index.postings.get(term) ?? []) {
      const lengthRatio = index.averageLength ? index.lengths[position] / index.averageLength : 1
      const saturation = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * lengthRatio))
      scores[position] += weight * idf * saturation
    }
  }
  return maximum > 0 ? scores.map((score) => score / maximum) : scores
}
