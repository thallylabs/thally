/**
 * Whether one OpenAPI operation is published, judged on the authored document
 * with the same path-item rules the normalizer and sanitizer use. A page bound
 * to a hidden or excluded operation is not published (its route 404s), so
 * every listing of pages consults this through `@/data/doc-publication`.
 */

import { HTTP_METHODS, buildOperationKey } from './operation-keys'
import { isObj, operationVisibility, viewPathEntry } from './path-items'
import type { OperationOverride } from './types'

/** `unknown`: no such operation (a typo, an unreachable `$ref`); treated as before, i.e. not judged. */
export type OperationPublicationState = 'published' | 'hidden' | 'excluded' | 'unknown'

export function operationPublicationState(
  document: unknown,
  method: string,
  path: string,
  overrides?: Record<string, OperationOverride>,
): OperationPublicationState {
  const verb = method.toLowerCase() as (typeof HTTP_METHODS)[number]
  if (!HTTP_METHODS.includes(verb) || !isObj(document) || !isObj(document.paths)) return 'unknown'
  const entry = document.paths[path]
  if (!isObj(entry)) return 'unknown'
  const view = viewPathEntry(document, entry)
  if (!isObj(view.item[verb])) return 'unknown'
  const visibility = operationVisibility(view, verb, overrides?.[buildOperationKey(verb, path)])
  return visibility === 'visible' ? 'published' : visibility
}
