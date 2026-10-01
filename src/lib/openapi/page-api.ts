/**
 * One reading of a page's API frontmatter (`openapi:` or manual `api:`), shared
 * by the page renderer (get-doc) and the page index (docs.ts), so the rendered
 * page, `/api/docs`, and agent-readiness can never disagree about whether a
 * page documents an operation.
 */

import { parseApiFrontmatter, type ManualApiTarget, type Warn } from '@/lib/openapi/manual-operation'
import { parseOpenApiFrontmatter, type OpenApiFrontmatterRef } from '@/lib/openapi/page-frontmatter'

export interface PageApiMetadata {
  /** `openapi: "[<spec>] METHOD /path"` or `"[<spec>] webhook <name>"`. */
  openapi: OpenApiFrontmatterRef | null
  /** Manual `api:` target; always null when `openapi:` is also set, which wins. */
  manual: ManualApiTarget | null
  /** Both keys were set, so `api:` was ignored. */
  shadowedApi: boolean
}

export function pageApiMetadata(
  frontmatter: { openapi?: unknown; api?: unknown } | null | undefined,
  warn?: Warn,
): PageApiMetadata {
  const openapi = parseOpenApiFrontmatter(frontmatter?.openapi)
  const hasApi = frontmatter?.api !== undefined && frontmatter.api !== null
  if (openapi || !hasApi) return { openapi, manual: null, shadowedApi: Boolean(openapi && hasApi) }
  return { openapi: null, manual: parseApiFrontmatter(frontmatter.api, warn), shadowedApi: false }
}

/**
 * The `openapi` block of the `/api/docs` JSON for an indexed page, or undefined
 * for a regular doc. A webhook page lists `webhooks` (names), never `operations`. `specUrl` is the served path of the page's own spec
 * (`servedSpecPathForFrontmatter`); without one no `spec_url` is advertised.
 */
export function docApiJson(entry: {
  openapi?: Pick<OpenApiFrontmatterRef, 'method' | 'path' | 'webhook'>
  manualTarget?: Pick<ManualApiTarget, 'method' | 'path'>
}, specUrl?: string): { spec_url?: string; operations?: Array<string>; webhooks?: Array<string> } | undefined {
  const spec = specUrl ? { spec_url: specUrl } : {}
  if (entry.openapi?.webhook) return { ...spec, webhooks: [entry.openapi.path] }
  if (entry.openapi) return { ...spec, operations: [`${entry.openapi.method.toUpperCase()} ${entry.openapi.path}`] }
  if (entry.manualTarget) return { operations: [`${entry.manualTarget.method} ${entry.manualTarget.path}`] }
  return undefined
}
