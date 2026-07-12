import { getContentDocument } from '@thallylabs/core'
import { getDocEntries, getNavigablePageIds } from '@/data/docs'
import type { PageFact } from '@/lib/agent-readiness/types'

/** Build deterministic page facts from the content graph + navigation. */
export function gatherPageFacts(): Array<PageFact> {
  const facts: Array<PageFact> = []
  const navPages = getNavigablePageIds()

  for (const entry of getDocEntries()) {
    const document = getContentDocument(entry.id)
    // Only pages bound to an OpenAPI operation count as API pages; MDX overview
    // pages under /api are regular docs and shouldn't be penalized.
    const isApi = Boolean(entry.openapi)

    facts.push({
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
    })
  }

  return facts
}
