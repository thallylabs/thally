/**
 * Optional golden-question retrieval evaluation.
 *
 * A site may list questions its docs must answer in `docs.json`:
 *
 * ```json
 * "readiness": {
 *   "topK": 5,
 *   "goldenQuestions": [
 *     { "question": "How do I rotate an API key?", "expect": ["/guides/api-keys"] }
 *   ]
 * }
 * ```
 *
 * Each question runs against the site's own full-text search index — no
 * network, no model, deterministic for a given release — and scores a hit when
 * any expected page appears in the top k results (hit@k). Configuration is
 * customer-owned and untrusted: it is bounded here so a large or malformed
 * block can never make a readiness request expensive. Managed releases also
 * cap the whole `docs.json` binding at 5 KB, which keeps hosted lists short.
 */

import type { GoldenQuestionResult, RetrievalFacts } from '@/lib/agent-readiness/types'

export const MAX_GOLDEN_QUESTIONS = 50
export const MAX_QUESTION_LENGTH = 300
export const MAX_EXPECTED_PAGES = 5
export const DEFAULT_TOP_K = 5
export const MAX_TOP_K = 10

export interface GoldenQuestion {
  question: string
  /** Normalized expected page paths (`/guides/x`). */
  expected: Array<string>
}

export interface GoldenQuestionConfig {
  k: number
  questions: Array<GoldenQuestion>
}

/** Search seam: returns the hrefs of the top `k` results for a query. */
export type GoldenSearch = (query: string, k: number) => Promise<Array<string>>

/** Normalize a page id, path, or same-site URL path to `/path` form. */
export function normalizeExpectedPage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // Full URLs would tie the config to one host; only ids and paths are accepted.
  if (!trimmed || trimmed.length > 300 || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return null
  const path = trimmed.split(/[?#]/)[0]
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') || '/' : '/'
}

function normalizeHref(href: string): string {
  return normalizeExpectedPage(href) ?? href
}

/**
 * Read the optional `readiness` block from a docs.json object. Invalid entries
 * are dropped rather than failing the report; returns null when no usable
 * questions are configured.
 */
export function readGoldenQuestionConfig(docsConfig: unknown): GoldenQuestionConfig | null {
  if (!docsConfig || typeof docsConfig !== 'object') return null
  const block = (docsConfig as { readiness?: unknown }).readiness
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const { goldenQuestions, topK } = block as { goldenQuestions?: unknown; topK?: unknown }
  if (!Array.isArray(goldenQuestions)) return null

  const questions: Array<GoldenQuestion> = []
  for (const entry of goldenQuestions.slice(0, MAX_GOLDEN_QUESTIONS)) {
    if (!entry || typeof entry !== 'object') continue
    const { question, expect } = entry as { question?: unknown; expect?: unknown }
    if (typeof question !== 'string') continue
    const text = question.trim().replace(/\s+/g, ' ')
    if (!text || text.length > MAX_QUESTION_LENGTH) continue
    const rawExpected = Array.isArray(expect) ? expect : [expect]
    const expected = [
      ...new Set(
        rawExpected
          .slice(0, MAX_EXPECTED_PAGES)
          .map(normalizeExpectedPage)
          .filter((path): path is string => Boolean(path)),
      ),
    ]
    if (expected.length) questions.push({ question: text, expected })
  }
  if (questions.length === 0) return null

  const k = typeof topK === 'number' && Number.isInteger(topK)
    ? Math.min(MAX_TOP_K, Math.max(1, topK))
    : DEFAULT_TOP_K
  return { k, questions }
}

/**
 * Run golden questions sequentially (bounded by MAX_GOLDEN_QUESTIONS) against
 * the search seam. `searchablePaths` are the pages present in the search
 * index; an expected page outside it can never be retrieved, which is a
 * configuration problem reported separately from a retrieval miss.
 */
export async function runGoldenQuestions(
  config: GoldenQuestionConfig,
  search: GoldenSearch,
  searchablePaths: ReadonlySet<string>,
): Promise<RetrievalFacts> {
  const results: Array<GoldenQuestionResult> = []
  try {
    for (const { question, expected } of config.questions) {
      const unsearchable = expected.filter((path) => !searchablePaths.has(path))
      const retrieved = (await search(question, config.k)).slice(0, config.k).map(normalizeHref)
      results.push({
        question,
        expected,
        retrieved,
        hit: expected.some((path) => retrieved.includes(path)),
        unsearchable,
      })
    }
  } catch {
    // The report is public: never echo an internal error message into it.
    return { k: config.k, results: [], error: 'The local search index could not be built.' }
  }
  return { k: config.k, results }
}
