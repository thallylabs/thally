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

export interface UnpublishedOperation {
  method: string
  path: string
  state: 'hidden' | 'excluded'
}

/**
 * Every hidden or excluded operation of an authored document. The build records
 * these because the copy a deployment serves is already filtered, so at runtime
 * the operations, and the reason a page bound to one is unpublished, are gone.
 */
export function listUnpublishedOperations(
  document: unknown,
  overrides?: Record<string, OperationOverride>,
): Array<UnpublishedOperation> {
  if (!isObj(document) || !isObj(document.paths)) return []
  const found: Array<UnpublishedOperation> = []
  for (const [path, entry] of Object.entries(document.paths)) {
    if (!isObj(entry)) continue
    const view = viewPathEntry(document, entry)
    for (const verb of HTTP_METHODS) {
      if (!isObj(view.item[verb])) continue
      const visibility = operationVisibility(view, verb, overrides?.[buildOperationKey(verb, path)])
      if (visibility !== 'visible') found.push({ method: verb.toUpperCase(), path, state: visibility })
    }
  }
  return found
}

/** Runtime-source file holding the build's list of unpublished operations. */
export const UNPUBLISHED_OPERATIONS_FILE = 'thally-unpublished-operations.json'
