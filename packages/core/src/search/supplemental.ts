/**
 * Supplemental search-record registry — the seam for searchable things that
 * are not authored pages.
 *
 * The page corpus is built by mapping every doc entry to its content document.
 * Generated API-reference operations have no MDX document, so the host
 * registers a resolver that returns ready-made records for them (and anything
 * similar in future). Core stays unaware of OpenAPI.
 *
 * Contract: a resolver failure (an unreachable remote spec, say) must never
 * take search down — `resolveSupplementalSearchRecords` swallows errors and
 * returns no records.
 */

/** Kinds of searchable record. Pages come from the doc-entry source; the rest are supplemental. */
export type SearchRecordType = 'page' | 'api_operation'

/** A ready-made, non-page search record supplied by the host. */
export interface SupplementalSearchRecord {
  /** Stable id, unique across pages and supplemental records (e.g. an operation's slug path). */
  id: string
  type: Exclude<SearchRecordType, 'page'>
  title: string
  description: string
  /** Site-relative URL of the record's human page. */
  href: string
  keywords: Array<string>
  /** Searchable prose beyond title/description (parameter names, summaries). */
  body?: string
  /** HTTP method, for API operations. */
  method?: string
  /** URL path template, for API operations. */
  path?: string
}

type SupplementalResolver = (locale?: string) => Promise<Array<SupplementalSearchRecord>>

let supplementalResolver: SupplementalResolver | null = null

/** Register the host's supplemental records. Idempotent, last-wins. */
export function registerSupplementalSearchRecordsSource(fn: SupplementalResolver): void {
  supplementalResolver = fn
}

/** Supplemental records for a locale; empty when none are registered or the resolver fails. */
export async function resolveSupplementalSearchRecords(locale?: string): Promise<Array<SupplementalSearchRecord>> {
  if (!supplementalResolver) return []
  try {
    return await supplementalResolver(locale)
  } catch {
    return []
  }
}
