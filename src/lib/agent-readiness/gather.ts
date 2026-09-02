/**
 * Converts the canonical content graph into the facts scored for readiness.
 * Local checks use embedded sources; deployed requests use the active source.
 */

import {
  getContentDocument,
  loadContentDocument,
  type ContentDocument,
} from '@/lib/content'
import { getDocEntries, getNavigablePageIds, loadDocEntries } from '@/data/docs'
import type { PageFact } from '@/lib/agent-readiness/types'

type DocEntry = ReturnType<typeof getDocEntries>[number]

function buildPageFact(
  entry: DocEntry,
  document: ContentDocument | null,
  navPages: ReadonlySet<string>,
): PageFact {
  // Only pages bound to an OpenAPI operation count as API pages; MDX overview
  // pages under /api are regular docs and shouldn't be penalized.
  const isApi = Boolean(entry.openapi)

  return {
    pageId: entry.id,
    href: entry.href,
    title: entry.title,
    description: entry.description,
    keywords: entry.keywords,
    hasContentDoc: Boolean(document),
    headingsCount: document?.content.headings.length ?? 0,
    textLength: document?.content.text.length ?? 0,
    codeBlocksCount: document?.content.codeBlocks.length ?? 0,
    inNav: navPages.has(entry.id) || entry.href === '/',
    isApi,
    hasOpenApiSpec: Boolean(entry.openapi),
    jsonLdValid: Boolean(entry.title) && Boolean(entry.description),
  }
}

/** Build deterministic page facts from the build-embedded content graph. */
export function gatherPageFacts(): Array<PageFact> {
  const navPages = getNavigablePageIds()
  return getDocEntries().map((entry) =>
    buildPageFact(entry, getContentDocument(entry.id), navPages),
  )
}

/**
 * Build page facts from the active runtime content source.
 *
 * Managed sites keep authored bytes in immutable assets instead of executable
 * Worker modules, so request-time readiness must use the async content source.
 * Local checks retain {@link gatherPageFacts} for their filesystem-fast path.
 */
export async function loadPageFacts(): Promise<Array<PageFact>> {
  // Large managed sites keep their release content index in immutable assets
  // instead of a Worker text binding. Hydrate that index before reading entry
  // metadata; otherwise readiness combines current page bodies with titles and
  // descriptions from the compiled fallback bundle.
  const entries = await loadDocEntries()
  const navPages = getNavigablePageIds()
  return Promise.all(
    entries.map(async (entry) =>
      buildPageFact(entry, await loadContentDocument(entry.id), navPages),
    ),
  )
}
