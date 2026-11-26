/**
 * Managed local-BM25 retrieval from verified full-section content assets.
 * Current anonymous listings and physical-file precedence stay authoritative;
 * any canonical fallback makes the whole resulting corpus ineligible to cache.
 */

import {
  chunkDocument, getEmbeddingProvider, getRelevantChunks, localHashProvider, rankLexicalChunks,
  type Chunk, type RankOptions, type RetrievalResult,
} from '@thallylabs/core/embeddings'
import { getContentSource, type ContentSource } from '@/lib/content-source'
import { contentFileCandidates, loadContentDocument } from '@/lib/content/document'
import { loadListedDocEntries } from '@/lib/search/register-doc-source'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { createBoundedPromiseCache, estimateRetainedPayloadBytes } from '@/lib/bounded-cache'
import { loadContentIndex } from '@/lib/content-index'
import { ensureAuthoritativeDocPublication } from '@/data/docs'
import { publishedContentUnavailable } from '@/lib/content-source/errors'

export { isPublishedContentUnavailable as isAiChatRetrievalUnavailable } from '@/lib/content-source/errors'

const MAX_CORPUS_BYTES = 8 * 1024 * 1024
interface RetrievalCorpus { chunks: Array<Chunk>; isFullyPrepared: boolean }

function createCorpusCache() {
  return createBoundedPromiseCache<RetrievalCorpus>({
    maxEntries: 2, maxBytes: MAX_CORPUS_BYTES,
    sizeOf: (corpus) => estimateRetainedPayloadBytes(corpus, MAX_CORPUS_BYTES),
    shouldCache: (corpus) => corpus.isFullyPrepared,
  })
}
const corpora = new WeakMap<ContentSource, ReturnType<typeof createCorpusCache>>()

async function preparedSections(source: ContentSource, pageId: string, locale?: string) {
  if (!source.retrievalContent) return undefined
  const candidates = contentFileCandidates(pageId, locale)
  for (const filePath of candidates) {
    if (!(await source.exists(filePath))) continue
    const prepared = await source.retrievalContent(filePath)
    if (!prepared) return undefined
    // An assets binding can appear after an embedded exists() fallback. A
    // verified record proves the immutable manifest is now loaded: recheck
    // the winner so that a restored translation can never lose to base text.
    for (const authoritativePath of candidates) {
      if (await source.exists(authoritativePath)) {
        return authoritativePath === filePath ? prepared : source.retrievalContent(authoritativePath)
      }
    }
    return undefined
  }
  return undefined
}

/** Load exact canonical chunks in the current anonymous listing's order. */
export async function loadAiChatRetrievalChunks(locale?: string): Promise<Array<Chunk>> {
  const source = getContentSource()
  if (source.kind === 'assets') {
    if (!(await loadContentIndex())) throw publishedContentUnavailable()
    await ensureAuthoritativeDocPublication()
  }
  const [entries, i18n] = await Promise.all([loadListedDocEntries(locale), getEffectiveI18nConfig()])
  const policy = getReaderAuthConfig()
  const listingIdentity = (listing: typeof entries) => JSON.stringify(listing.map(({ id, title, href }) => [id, title, href]))
  const initialListing = listingIdentity(entries)
  const key = JSON.stringify([
    locale ?? null, i18n.defaultLocale,
    policy.isEnabled, policy.isMisconfigured, policy.defaultVisibility, policy.sessionEpoch,
    initialListing,
  ])
  const build = async (listing: typeof entries): Promise<RetrievalCorpus> => {
    const pages = await Promise.all(listing.map(async (entry) => {
      const prepared = source.kind === 'assets' ? await preparedSections(source, entry.id, locale) : undefined
      const document = prepared ? null : await loadContentDocument(entry.id, locale, { publishedOnly: source.kind === 'assets' })
      if (!prepared && !document && source.kind === 'assets') throw publishedContentUnavailable()
      const sections = prepared?.sections ?? document?.content.sections
      return {
        isPrepared: Boolean(prepared),
        chunks: sections ? chunkDocument({ pageId: entry.id, title: entry.title, href: entry.href, sections }) : [],
      }
    }))
    return { chunks: pages.flatMap((page) => page.chunks), isFullyPrepared: pages.length > 0 && pages.every((page) => page.isPrepared) }
  }
  const load = async (): Promise<RetrievalCorpus> => {
    const corpus = await build(entries)
    if (!corpus.isFullyPrepared) return corpus
    // A binding restored during loading can make an earlier embedded listing
    // incomplete. Verified assets now establish authority: serve a refreshed
    // listing, but never retain its result under that earlier listing's key.
    const confirmed = await loadListedDocEntries(locale)
    if (listingIdentity(confirmed) !== initialListing) return { ...(await build(confirmed)), isFullyPrepared: false }
    return corpus
  }
  if (source.kind !== 'assets') return (await load()).chunks
  let cache = corpora.get(source)
  if (!cache) { cache = createCorpusCache(); corpora.set(source, cache) }
  return (await cache.getOrLoad(key, load)).chunks
}

/** Keep hosted/filesystem behavior intact; local BM25 needs no dense vectors. */
export async function getAiChatRelevantChunks(query: string, options: RankOptions = {}): Promise<Array<RetrievalResult>> {
  if (getContentSource().kind !== 'assets' || getEmbeddingProvider().id !== localHashProvider.id) return getRelevantChunks(query, options)
  const trimmed = query.trim()
  return trimmed ? rankLexicalChunks(trimmed, await loadAiChatRetrievalChunks(), options) : []
}

/** Test-only ownership inspection; no content or reader identity is exposed. */
export function aiChatRetrievalCacheSnapshotForTests(source: ContentSource) {
  return corpora.get(source)?.snapshot() ?? { entries: 0, bytes: 0 }
}
