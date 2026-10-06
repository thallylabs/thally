/**
 * Section-level retrieval: rank heading-bounded sections instead of pages.
 *
 * Agents usually need one section, not a whole page. This reuses the exact
 * chunker the AI-answer path uses (`chunkDocument`: heading path, anchor,
 * paragraph-window splitting) over the same structured content documents, and
 * ranks with BM25 only. It deliberately never calls the embedding provider:
 * it backs a public, anonymous endpoint (MCP `search_sections`), and a hosted
 * provider would turn every anonymous query into a billed API call.
 *
 * The chunk corpus is built once per locale per process and memoized; the
 * lexical index is memoized per chunk array inside `rankLexicalChunks`.
 */

import { loadContentDocument } from '../content/index.js'
import { resolveDocEntriesAsync } from '../doc-source.js'
import { chunkDocument } from '../embeddings/chunk.js'
import { rankLexicalChunks } from '../embeddings/retrieve.js'
import type { Chunk } from '../embeddings/types.js'

export interface SectionHit {
  pageId: string
  /** Page title. */
  title: string
  /** Site-relative page URL (localized when a locale was requested). */
  href: string
  /** Heading of the matched section (the page title for a preamble). */
  heading: string
  /** Ancestor heading texts, outermost first, including `heading`. */
  headingPath: Array<string>
  /** Heading id to deep-link with (`href#anchor`); '' for a page preamble. */
  anchor: string
  /** BM25 share of the query's evidence this section matched, in [0, 1). */
  score: number
  /** Section text (prose and code), bounded by the token budget. */
  content: string
  /** Estimated tokens of `content`. */
  tokens: number
}

export interface SearchSectionsOptions {
  limit?: number
  locale?: string
  /** Max cumulative estimated tokens across returned sections (default 3000). */
  tokenBudget?: number
  /** Max sections from one page (default 3), so one long page cannot fill every slot. */
  maxPerPage?: number
}

const sectionCorpora = new Map<string, Promise<Array<Chunk>>>()

async function buildSectionCorpus(locale?: string): Promise<Array<Chunk>> {
  const entries = await resolveDocEntriesAsync(locale)
  const perPage = await Promise.all(entries.map(async (entry) => {
    const document = await loadContentDocument(entry.id, locale)
    if (!document?.content.sections) return []
    return chunkDocument({
      pageId: entry.id,
      href: entry.href,
      title: entry.title,
      sections: document.content.sections,
    })
  }))
  return perPage.flat()
}

/** The memoized chunk corpus for a locale (default locale when omitted). */
export function getSectionCorpus(locale?: string): Promise<Array<Chunk>> {
  const key = locale ?? ''
  const cached = sectionCorpora.get(key)
  if (cached) return cached
  const pending = buildSectionCorpus(locale)
  sectionCorpora.set(key, pending)
  // A failed build must not poison the cache for the life of the process.
  pending.catch(() => sectionCorpora.delete(key))
  return pending
}

/** Drop memoized section corpora (used by `resetSearchEngine`). */
export function resetSectionCorpora() {
  sectionCorpora.clear()
}

/** Strip the heading-path prefix line `chunkDocument` adds for ranking context. */
function chunkBody(chunk: Chunk): string {
  const prefix = chunk.headingPath.join(' > ')
  return chunk.text.startsWith(`${prefix}\n`) ? chunk.text.slice(prefix.length + 1).trim() : chunk.text
}

/** Rank documentation sections for a query with BM25. */
export async function searchSections(query: string, options: SearchSectionsOptions = {}): Promise<Array<SectionHit>> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const chunks = await getSectionCorpus(options.locale)
  const results = rankLexicalChunks(trimmed, chunks, {
    k: options.limit ?? 8,
    tokenBudget: options.tokenBudget ?? 3000,
    maxPerPage: options.maxPerPage ?? 3,
  })
  return results.map(({ chunk, score }) => ({
    pageId: chunk.pageId,
    title: chunk.title,
    href: chunk.href,
    heading: chunk.heading,
    headingPath: chunk.headingPath,
    anchor: chunk.anchor,
    score,
    content: chunkBody(chunk),
    tokens: chunk.tokens,
  }))
}
