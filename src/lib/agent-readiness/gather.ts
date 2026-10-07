/**
 * Converts the canonical content graph into the facts scored for readiness.
 * Local checks use embedded sources; deployed requests use the active source.
 *
 * Every page document is loaded exactly once per evaluation. Page facts,
 * the internal-link index, and JSON-LD validation all derive from that single
 * pass; OpenAPI and golden-question facts reuse the site's existing spec and
 * search caches. Site-level gathering never throws: a source that fails is
 * reported as an unavailable check instead of failing the report.
 */

import {
  getContentDocument,
  loadContentDocument,
  type ContentDocument,
} from '@/lib/content'
import {
  getBreadcrumbs,
  getCurrentVersionPageIds,
  getDocEntries,
  getI18nConfig,
  getNavigablePageIds,
  getRedirectsConfig,
  isDocEntryVisibleTo,
  loadDocEntries,
} from '@/data/docs'
import { getDocsJsonConfig } from '@/lib/docs-json-config'
import { buildDocPageJsonLd } from '@/lib/json-ld'
import { getSiteUrl } from '@/lib/site-url'
import { validateDocJsonLd } from '@/lib/agent-readiness/json-ld'
import {
  compileRedirectSource,
  findBrokenLinks,
  normalizePath,
  type LinkIndex,
} from '@/lib/agent-readiness/links'
import {
  readGoldenQuestionConfig,
  runGoldenQuestions,
  type GoldenSearch,
} from '@/lib/agent-readiness/golden'
import type {
  OperationExampleFact,
  OperationFacts,
  PageFact,
  RetrievalFacts,
} from '@/lib/agent-readiness/types'
import type { NormalizedMediaType, NormalizedOperation } from '@/lib/openapi/types'

type DocEntry = ReturnType<typeof getDocEntries>[number]

/**
 * Approximate token count for a character length. Matches the retrieval
 * chunker's estimate (~4 characters per token): coarse, but deterministic and
 * tokenizer-independent, which is what a budget check needs.
 */
export function approximateTokens(characters: number): number {
  return Math.ceil(characters / 4)
}

/** A YAML date may arrive as a string or (with some schemas) a Date. */
function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

/**
 * Explicit `id="…"` targets in the authored body (JSX anchors). These are
 * valid link fragments the heading list cannot see. Scanning only widens the
 * set of accepted anchors, so a match inside a code sample can hide a broken
 * anchor but never invent one.
 */
function explicitAnchorIds(rawBody: string): Array<string> {
  const ids: Array<string> = []
  for (const match of rawBody.matchAll(/\bid=["']([^"'\s]{1,200})["']/g)) ids.push(match[1])
  return ids
}

function pageAnchors(document: ContentDocument | null): Set<string> {
  if (!document) return new Set()
  return new Set([
    ...document.content.headings.map((heading) => heading.id),
    ...explicitAnchorIds(document.rawBody ?? ''),
  ])
}

function buildLinkIndex(
  entries: ReadonlyArray<DocEntry>,
  documents: ReadonlyMap<string, ContentDocument | null>,
  extraPaths: ReadonlySet<string>,
): LinkIndex {
  const pages = new Map<string, ReadonlySet<string>>()
  const unchecked = new Set(extraPaths)
  for (const entry of entries) {
    const paths = [normalizePath(entry.href), `/${entry.id}`]
    if (isApiEntry(entry)) {
      // The operation panel renders its own anchors (parameters, responses).
      for (const path of paths) unchecked.add(path)
      continue
    }
    const anchors = pageAnchors(documents.get(entry.id) ?? null)
    // `/introduction` and `/` both reach the root page, whichever is canonical.
    for (const path of paths) if (!pages.has(path)) pages.set(path, anchors)
  }
  if (!pages.has('/') && !unchecked.has('/')) pages.set('/', new Set())

  const i18n = getI18nConfig()
  const locales = new Set(
    (i18n?.locales ?? [])
      .map((locale) => locale.code)
      .filter((code) => code && code !== i18n?.defaultLocale),
  )
  const redirects = getRedirectsConfig()
    .map((redirect) => compileRedirectSource(redirect.source))
    .filter((matcher): matcher is RegExp => matcher !== null)

  return { pages, extraPaths: unchecked, redirects, locales }
}

function codeFacts(document: ContentDocument | null): { count: number; untagged?: number } {
  const blocks = document?.content.codeBlocks ?? []
  // Engines older than the `hasLanguageTag` field cannot distinguish an
  // untagged fence from an explicit `text` one; report "unknown" instead of
  // guessing so the check skips rather than mis-scores.
  const known = blocks.every((block) => typeof (block as { hasLanguageTag?: unknown }).hasLanguageTag === 'boolean')
  if (!known) return { count: blocks.length }
  return {
    count: blocks.length,
    untagged: blocks.filter((block) => !(block as { hasLanguageTag?: boolean }).hasLanguageTag).length,
  }
}

function largestSection(document: ContentDocument | null): PageFact['largestSection'] {
  let largest: PageFact['largestSection']
  for (const section of document?.content.sections ?? []) {
    const chars = section.text.length + section.code.reduce((sum, block) => sum + block.source.length, 0)
    const tokens = approximateTokens(chars)
    if (!largest || tokens > largest.approxTokens) {
      largest = { title: section.title || 'Introduction', approxTokens: tokens }
    }
  }
  return largest
}

function jsonLdIssues(entry: DocEntry, siteUrl: string): PageFact['jsonLdIssues'] {
  // Same inputs the docs page route passes, so this validates what ships.
  const payload = buildDocPageJsonLd({
    siteUrl,
    pageUrl: `${siteUrl}${entry.href}`,
    id: entry.id,
    title: entry.title,
    description: entry.description,
    keywords: entry.keywords,
    lastUpdated: dateString(entry.lastUpdated as unknown),
    breadcrumb: getBreadcrumbs(entry.href),
  })
  return validateDocJsonLd(payload)
}

/**
 * The single predicate for whether a page may be named in public readiness
 * output (API route, MCP tool) and counts as publicly searchable. Pages it
 * rejects are still scored, but only counted, never listed.
 *
 * Reader-auth gated pages (`public: false`, `groups`, or a private site
 * default) are judged for the anonymous reader: readiness is a public report,
 * so a page an anonymous visitor cannot open is never named. Extend this when
 * new visibility controls ship.
 */
export function isPubliclyListedPage(entry: Pick<DocEntry, 'hidden' | 'noindex' | 'access'>): boolean {
  return !entry.hidden && !entry.noindex && isDocEntryVisibleTo(entry)
}

/**
 * Only pages bound to an operation (OpenAPI or manual `api:`) count as API
 * pages; MDX overview pages under /api are regular docs and shouldn't be
 * penalized.
 */
function isApiEntry(entry: DocEntry): boolean {
  return Boolean(entry.openapi || entry.manualTarget)
}

function buildPageFact(
  entry: DocEntry,
  document: ContentDocument | null,
  navPages: ReadonlySet<string>,
  linkIndex: LinkIndex,
  siteUrl: string,
): PageFact {
  const isApi = isApiEntry(entry)
  const code = codeFacts(document)
  const codeChars = (document?.content.codeBlocks ?? []).reduce((sum, block) => sum + block.source.length, 0)

  return {
    pageId: entry.id,
    href: entry.href,
    title: entry.title,
    description: entry.description,
    keywords: entry.keywords,
    hasContentDoc: Boolean(document),
    headingsCount: document?.content.headings.length ?? 0,
    headingDepths: document?.content.headings.map((heading) => heading.depth) ?? [],
    textLength: document?.content.text.length ?? 0,
    contentLength: (document?.content.text.length ?? 0) + codeChars,
    approxTokens: approximateTokens(document?.content.markdown.length ?? 0),
    largestSection: largestSection(document),
    codeBlocksCount: code.count,
    untaggedCodeBlocks: code.untagged,
    inNav: navPages.has(entry.id) || entry.href === '/',
    isApi,
    hasOpenApiSpec: Boolean(entry.openapi),
    hasManualOperation: Boolean(entry.manualTarget && !entry.openapi),
    jsonLdIssues: jsonLdIssues(entry, siteUrl),
    brokenLinks: document
      ? findBrokenLinks(document.content.links.map((link) => link.url), isApi ? null : pageAnchors(document), linkIndex)
      : [],
    lastVerified: dateString(entry.lastVerified as unknown),
    unlisted: !isPubliclyListedPage(entry),
  }
}

function buildPageFacts(
  entries: ReadonlyArray<DocEntry>,
  documents: ReadonlyMap<string, ContentDocument | null>,
  extraPaths: ReadonlySet<string> = new Set(),
): Array<PageFact> {
  const navPages = getNavigablePageIds()
  const linkIndex = buildLinkIndex(entries, documents, extraPaths)
  const siteUrl = getSiteUrl().replace(/\/+$/, '')
  return entries.map((entry) =>
    buildPageFact(entry, documents.get(entry.id) ?? null, navPages, linkIndex, siteUrl),
  )
}

/** Build deterministic page facts from the build-embedded content graph. */
export function gatherPageFacts(): Array<PageFact> {
  const entries = getDocEntries()
  const documents = new Map(entries.map((entry) => [entry.id, getContentDocument(entry.id)]))
  return buildPageFacts(entries, documents)
}

async function loadEntriesAndDocuments(source: 'embedded' | 'runtime') {
  if (source === 'embedded') {
    const entries = getDocEntries()
    return { entries, documents: new Map(entries.map((entry) => [entry.id, getContentDocument(entry.id)])) }
  }
  // Large managed sites keep their release content index in immutable assets
  // instead of a Worker text binding. Hydrate that index before reading entry
  // metadata; otherwise readiness combines current page bodies with titles and
  // descriptions from the compiled fallback bundle.
  const entries = await loadDocEntries()
  const loaded = await Promise.all(
    entries.map(async (entry) => [entry.id, await loadContentDocument(entry.id)] as const),
  )
  return { entries, documents: new Map(loaded) }
}

/**
 * Build page facts from the active runtime content source.
 *
 * Managed sites keep authored bytes in immutable assets instead of executable
 * Worker modules, so request-time readiness must use the async content source.
 * Local checks retain {@link gatherPageFacts} for their filesystem-fast path.
 */
export async function loadPageFacts(): Promise<Array<PageFact>> {
  const { entries, documents } = await loadEntriesAndDocuments('runtime')
  return buildPageFacts(entries, documents)
}

function hasAuthoredExample(contents: ReadonlyArray<NormalizedMediaType>): boolean {
  return contents.some((content) => {
    const schema = content.schema as { example?: unknown; examples?: unknown } | undefined
    return (
      content.example !== undefined ||
      content.examples.length > 0 ||
      schema?.example !== undefined ||
      (Array.isArray(schema?.examples) && schema.examples.length > 0)
    )
  })
}

/** Example coverage for one normalized operation (pure; exported for tests). */
export function operationExampleFact(operation: NormalizedOperation, href: string): OperationExampleFact {
  const requestContents = operation.requestBody?.contents ?? []
  const successContents = operation.responses
    .filter((response) => /^2\d\d$|^2XX$/i.test(response.code))
    .flatMap((response) => response.contents)
  return {
    key: `${operation.specId}:${operation.key}`,
    href,
    title: operation.title,
    hasRequestBody: requestContents.length > 0,
    hasRequestExample: hasAuthoredExample(requestContents),
    hasSuccessContent: successContents.length > 0,
    hasResponseExample: hasAuthoredExample(successContents),
  }
}

/**
 * Load published OpenAPI operations. Specs are read through the site's own
 * cached loader; a URL-sourced spec that cannot be fetched marks the check
 * unavailable rather than failing the report.
 */
async function loadOperationFacts(): Promise<OperationFacts | null> {
  try {
    const { apiReferenceConfig } = await import('@/config/api-reference')
    if (apiReferenceConfig.specs.length === 0) return null
    const { getAllApiOperationNodes } = await import('@/data/api-reference')
    const nodes = await getAllApiOperationNodes()
    return { operations: nodes.map((node) => operationExampleFact(node.operation, node.href)) }
  } catch {
    return { operations: [], error: 'The OpenAPI specification could not be loaded.' }
  }
}

/** Fulltext search only: hybrid mode would embed the query and lose determinism. */
const defaultGoldenSearch: GoldenSearch = async (query, k) => {
  const { searchDocs } = await import('@/lib/search/engine')
  const hits = await searchDocs(query, { mode: 'fulltext', limit: k })
  return hits.map((hit) => hit.href)
}

async function loadRetrievalFacts(
  entries: ReadonlyArray<DocEntry>,
  search: GoldenSearch,
): Promise<RetrievalFacts | null> {
  const config = readGoldenQuestionConfig(getDocsJsonConfig())
  if (!config) return null

  // Expected pages may be written as ids or paths; compare canonical hrefs.
  const canonical = new Map<string, string>()
  for (const entry of entries) {
    canonical.set(`/${entry.id}`, entry.href)
    canonical.set(normalizePath(entry.href), entry.href)
  }
  const currentVersion = getCurrentVersionPageIds()
  const searchable = new Set(
    entries
      .filter((entry) => isPubliclyListedPage(entry) && (!currentVersion || currentVersion.has(entry.id)))
      .map((entry) => entry.href),
  )
  const questions = config.questions.map((question) => ({
    ...question,
    expected: [...new Set(question.expected.map((path) => canonical.get(path) ?? path))],
  }))
  return runGoldenQuestions({ ...config, questions }, search, searchable)
}

/** Every fact the v2 methodology scores, gathered in one pass. */
export interface ReadinessFacts {
  pages: Array<PageFact>
  operations: OperationFacts | null
  retrieval: RetrievalFacts | null
}

export interface GatherOptions {
  /** `runtime` reads the active content source (deployed); `embedded` the build-time sources (CLI). */
  source?: 'embedded' | 'runtime'
  /** Search seam for golden questions; defaults to the site's full-text index. */
  search?: GoldenSearch
}

/**
 * Gather page facts plus the site-level facts (OpenAPI examples, golden
 * questions) that need async sources.
 */
export async function gatherReadinessFacts(options: GatherOptions = {}): Promise<ReadinessFacts> {
  const { entries, documents } = await loadEntriesAndDocuments(options.source ?? 'runtime')
  const operations = await loadOperationFacts()
  const operationPaths = new Set((operations?.operations ?? []).map((operation) => normalizePath(operation.href)))
  const pages = buildPageFacts(entries, documents, operationPaths)
  const retrieval = await loadRetrievalFacts(entries, options.search ?? defaultGoldenSearch)
  return { pages, operations, retrieval }
}
