/**
 * Path-item resolution and visibility, shared by the normalizer (nav, routes,
 * search) and the publication sanitizer (`/openapi.json`, `/openapi.yaml`) so
 * both always agree on which operations are excluded or hidden.
 *
 * A `paths` / `webhooks` entry may be inline or a `$ref` (to
 * `#/components/pathItems/*`, `#/paths/*`, or any local pointer), possibly a
 * chain of refs. `x-excluded` / `x-hidden` may sit on the entry itself (next
 * to `$ref`), on any referenced item, or on the operation.
 *
 * Fail-safe: a `$ref` that cannot be followed (external file, missing target,
 * cycle) yields an incomplete view. Flags found on the levels that were
 * reached are still honoured; nothing beyond them can be evaluated.
 */

import { HTTP_METHODS, isExtensionSet } from './operation-keys'
import type { OperationOverride } from './types'

export type Obj = Record<string, unknown>

export const isObj = (value: unknown): value is Obj =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const unescapePointer = (segment: string) => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // keep the raw segment
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Resolve a local `#/...` JSON pointer against the document; undefined if not local or missing. */
export function resolveLocalRef(document: unknown, ref: string): unknown {
  if (ref !== '#' && !ref.startsWith('#/')) return undefined
  let node: unknown = document
  for (const segment of ref.slice(2).split('/').filter(Boolean)) {
    if (!isObj(node) && !Array.isArray(node)) return undefined
    node = (node as Obj)[unescapePointer(segment)]
  }
  return node
}

export interface PathEntryView {
  /** The entry, then each `$ref` target that could be followed. */
  chain: Array<Obj>
  /** False when a `$ref` was external, missing or circular. */
  complete: boolean
  /** Merged item (nearest level wins), without `$ref`. */
  item: Obj
  /** `x-excluded` set on any level. */
  excluded: boolean
  /** `x-hidden` set on any level. */
  hidden: boolean
  /** The entry itself is a `$ref`. */
  isRef: boolean
}

export function viewPathEntry(document: unknown, entry: Obj): PathEntryView {
  const chain: Array<Obj> = [entry]
  const seen = new Set<Obj>([entry])
  let complete = true
  let current = entry
  while (typeof current.$ref === 'string') {
    const target = resolveLocalRef(document, current.$ref)
    if (!isObj(target) || seen.has(target)) {
      complete = false
      break
    }
    seen.add(target)
    chain.push(target)
    current = target
  }
  const item: Obj = Object.assign({}, ...[...chain].reverse())
  delete item.$ref
  return {
    chain,
    complete,
    item,
    excluded: chain.some((level) => isExtensionSet(level['x-excluded'])),
    hidden: chain.some((level) => isExtensionSet(level['x-hidden'])),
    isRef: typeof entry.$ref === 'string',
  }
}

export type OperationVisibility = 'visible' | 'hidden' | 'excluded'

/** Visibility of one method of an entry. An override decides `hidden`, never `excluded`. */
export function operationVisibility(
  view: PathEntryView,
  method: (typeof HTTP_METHODS)[number],
  override?: OperationOverride,
): OperationVisibility {
  const op = view.item[method]
  if (!isObj(op)) return 'visible'
  if (view.excluded || isExtensionSet(op['x-excluded'])) return 'excluded'
  const hidden = override?.hidden ?? (view.hidden || isExtensionSet(op['x-hidden']))
  return hidden ? 'hidden' : 'visible'
}

export function methodsOf(item: Obj) {
  return HTTP_METHODS.filter((method) => isObj(item[method]))
}
