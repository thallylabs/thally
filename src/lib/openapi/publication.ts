/**
 * Whether one OpenAPI operation is published, judged on the authored document
 * with the same path-item rules the normalizer and sanitizer use. A page bound
 * to an excluded operation is not published (its route 404s), so the build
 * records which pages it withholds (`pageReferenceState`), and `isDocPublished`
 * in `@/data/docs` is the one predicate every listing consults. A hidden
 * operation only stays out of generated navigation and pages, so a page that
 * names it still renders it (`hiddenOperationSpec`, `revealedOperations`).
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

const referenceState = (ref: OpenApiFrontmatterRef, spec: RoutedSpec): OperationPublicationState => spec.document === undefined
  ? 'unknown'
  : ref.webhook
    ? webhookPublicationState(spec.document, ref.path, spec.config.operationOverrides)
    : operationPublicationState(spec.document, ref.method, ref.path, spec.config.operationOverrides)

/** The spec a reference's prefix pins, if it names one of `specs`. */
function pinnedSpec(ref: OpenApiFrontmatterRef, specs: ReadonlyArray<RoutedSpec>): RoutedSpec | undefined {
  const config = ref.specRef ? findSpecForRef(specs.map((spec) => spec.config), ref.specRef) : null
  return config ? specs.find((entry) => entry.config === config) : undefined
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
  const judge = (spec: RoutedSpec) => referenceState(ref, spec)
  if (ref.specRef) {
    const spec = pinnedSpec(ref, specs)
    return spec ? judge(spec) : 'unknown'
  }
  const states = specs.map(judge)
  if (states.includes('published')) return 'published'
  // A spec the build cannot read may still serve it.
  if (specs.some((spec) => spec.document === undefined)) return 'unknown'
  return states.find((state) => state === 'hidden' || state === 'excluded') ?? 'unknown'
}

/**
 * The spec whose hidden operation a page naming `ref` renders: the pinned one, else the first, in route order, that hides
 * it. Undefined when the page's state (`pageReferenceState`) is anything but `hidden`, so an excluded operation is
 * never returned.
 */
export function hiddenOperationSpec(ref: OpenApiFrontmatterRef, specs: ReadonlyArray<RoutedSpec>): RoutedSpec | undefined {
  if (pageReferenceState(ref, specs) !== 'hidden') return undefined
  const pinned = pinnedSpec(ref, specs)
  return (pinned ? [pinned] : specs).find((spec) => referenceState(ref, spec) === 'hidden')
}

/** Overrides that show the operation a page names (every method of a webhook), for the page that renders it. */
export function revealedOperations(ref: OpenApiFrontmatterRef): Record<string, OperationOverride> {
  const methods = ref.webhook ? HTTP_METHODS : [ref.method]
  return Object.fromEntries(methods.map((method) => [buildOperationKey(method, ref.path, ref.webhook), { hidden: false }]))
}

/** Runtime-source file holding the build's list of unpublished page ids (see `pageReferenceState`). */
export const UNPUBLISHED_PAGES_FILE = 'thally-unpublished-pages.json'
