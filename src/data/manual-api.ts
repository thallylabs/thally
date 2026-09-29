/** Server-side lookup of a manual API page's operation, used by the Try It relay. */

import { getDocFromParams } from '@/data/get-doc'
import type { NormalizedOperation } from '@/lib/openapi/types'

/**
 * Re-derive the synthetic operation from the page's own frontmatter and the
 * site's docs.json, never from anything the browser sent besides the page id.
 */
export async function getManualApiOperation(pageId: string): Promise<NormalizedOperation | null> {
  const segments = pageId.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null
  const doc = await getDocFromParams(segments)
  return doc?.manualApi ?? null
}
