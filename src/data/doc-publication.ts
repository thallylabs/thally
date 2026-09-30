/**
 * Decides which documentation pages are published. The docs page route 404s a
 * page whose `openapi:` frontmatter resolves to a hidden or excluded operation,
 * so that page must also be absent from every listing (navigation, search,
 * sitemap, llms.txt, agent and MCP surfaces). The decision is made here once,
 * from the same operation lookup the route uses, and installed with
 * `setUnpublishedPageIds`; consumers ask `isDocPublished` from `@/data/docs`.
 */

import { getOperationPublicationState } from '@/data/api-reference'
import { loadUnfilteredDocEntries, setUnpublishedPageIds, type DocEntry } from '@/data/docs'
import { getDocsJsonConfigRevision } from '@/lib/docs-json-config'

/** Page ids whose documented operation is certainly hidden or excluded. Unknown operations stay published. */
export async function findUnpublishedPageIds(
  entries: ReadonlyArray<Pick<DocEntry, 'id' | 'openapi'>>,
): Promise<Array<string>> {
  const states = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.openapi) return null
      const state = await getOperationPublicationState(entry.openapi.method, entry.openapi.path, entry.openapi.specId)
      return state === 'hidden' || state === 'excluded' ? entry.id : null
    }),
  )
  return states.filter((id): id is string => id !== null)
}

let primed: { revision: number; promise: Promise<void> } | null = null

/** Idempotent; awaited by every async loader before it lists pages. */
export function primeDocPublication(): Promise<void> {
  const revision = getDocsJsonConfigRevision()
  if (primed?.revision === revision) return primed.promise
  const promise = (async () => {
    try {
      setUnpublishedPageIds(await findUnpublishedPageIds(await loadUnfilteredDocEntries()))
    } catch (error) {
      // Listing pages beats failing every request; the route itself still 404s.
      console.warn('[thally] could not evaluate which OpenAPI pages are published', error)
    }
  })()
  primed = { revision, promise }
  return promise
}
