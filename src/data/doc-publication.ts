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
import { getContentSource } from '@/lib/content-source'
import { getDocsJsonConfigRevision } from '@/lib/docs-json-config'
import { UNPUBLISHED_OPERATIONS_FILE, type UnpublishedOperation } from '@/lib/openapi/publication'

/**
 * Operations the build found hidden or excluded (`METHOD /path`). The served
 * spec no longer contains them, so this is the only record that a missing
 * operation was withheld rather than mistyped.
 */
async function loadRecordedUnpublishedOperations(): Promise<Set<string>> {
  try {
    const file = await getContentSource().read(UNPUBLISHED_OPERATIONS_FILE)
    const list = file ? (JSON.parse(String(file.content)) as Array<UnpublishedOperation>) : []
    return new Set(list.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`))
  } catch {
    return new Set()
  }
}

/**
 * Page ids whose documented operation is certainly hidden or excluded: judged
 * from the spec when it still shows the operation, else from the build's record
 * of what it withheld. Unknown operations stay published.
 */
export async function findUnpublishedPageIds(
  entries: ReadonlyArray<Pick<DocEntry, 'id' | 'openapi'>>,
  recorded: ReadonlySet<string> = new Set(),
): Promise<Array<string>> {
  const states = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.openapi) return null
      const state = await getOperationPublicationState(entry.openapi.method, entry.openapi.path, entry.openapi.specId)
      if (state === 'hidden' || state === 'excluded') return entry.id
      return state === 'unknown' && recorded.has(`${entry.openapi.method.toUpperCase()} ${entry.openapi.path}`) ? entry.id : null
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
      setUnpublishedPageIds(await findUnpublishedPageIds(await loadUnfilteredDocEntries(), await loadRecordedUnpublishedOperations()))
    } catch (error) {
      // Listing pages beats failing every request; the route itself still 404s.
      console.warn('[thally] could not evaluate which OpenAPI pages are published', error)
    }
  })()
  primed = { revision, promise }
  return promise
}
