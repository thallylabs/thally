/**
 * Whether one OpenAPI operation is published, judged on the authored document
 * with the same path-item rules the normalizer and sanitizer use. A page bound
 * to a hidden or excluded operation is not published (its route 404s), so
 * the build records which pages it withholds (`pageReferenceState`), and
 * `isDocPublished` in `@/data/docs` is the one predicate every listing consults.
 */

import { HTTP_METHODS, buildOperationKey } from './operation-keys'
import { findSpecForRef, type OpenApiFrontmatterRef } from './page-frontmatter'
import { isObj, methodsOf, operationVisibility, viewPathEntry } from './path-items'
import type { ApiSpecConfig, OperationOverride } from './types'

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

/**
 * A webhook page renders when any method of the `webhooks` entry is visible
 * (the normalizer only reads `webhooks`, so `x-webhooks` never renders one).
 * Overrides key webhooks as `WEBHOOK METHOD name`.
 */
export function webhookPublicationState(
  document: unknown,
  name: string,
  overrides?: Record<string, OperationOverride>,
): OperationPublicationState {
  if (!isObj(document) || !isObj(document.webhooks) || !Object.hasOwn(document.webhooks, name)) return 'unknown'
  const entry = document.webhooks[name]
  if (!isObj(entry)) return 'unknown'
  const view = viewPathEntry(document, entry)
  const states = methodsOf(view.item).map((method) => operationVisibility(view, method, overrides?.[buildOperationKey(method, name, true)]))
  if (states.length === 0) return 'unknown'
  return states.find((state) => state === 'visible') ? 'published' : states[0] as 'hidden' | 'excluded'
}

/** A spec the docs route can serve operations from, as the build sees it. */
export interface RoutedSpec {
  config: ApiSpecConfig
  /** The authored document; undefined when it cannot be read here (remote or unparseable), so nothing is judged against it. */
  document?: unknown
}

/**
 * Whether the docs route renders the operation a page's `openapi:` names,
 * following `getApiOperationForFrontmatter` in `@/data/api-reference`:
 * a spec prefix pins that one spec; a bare reference tries the default spec
 * and then every other one, so it renders when any of them publishes it.
 * `specs` must be in route order (the default spec first). Anything that
 * cannot be read is `unknown`, which is never withheld.
 */
export function pageReferenceState(ref: OpenApiFrontmatterRef, specs: ReadonlyArray<RoutedSpec>): OperationPublicationState {
  const judge = (spec: RoutedSpec): OperationPublicationState => spec.document === undefined
    ? 'unknown'
    : ref.webhook
      ? webhookPublicationState(spec.document, ref.path, spec.config.operationOverrides)
      : operationPublicationState(spec.document, ref.method, ref.path, spec.config.operationOverrides)
  if (ref.specRef) {
    const config = findSpecForRef(specs.map((spec) => spec.config), ref.specRef)
    const spec = config ? specs.find((entry) => entry.config === config) : undefined
    return spec ? judge(spec) : 'unknown'
  }
  const states = specs.map(judge)
  if (states.includes('published')) return 'published'
  // A spec the build cannot read may still serve it.
  if (specs.some((spec) => spec.document === undefined)) return 'unknown'
  return states.find((state) => state === 'hidden' || state === 'excluded') ?? 'unknown'
}

/** Runtime-source file holding the build's list of unpublished page ids (see `pageReferenceState`). */
export const UNPUBLISHED_PAGES_FILE = 'thally-unpublished-pages.json'
