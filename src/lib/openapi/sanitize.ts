/**
 * Publication filter for raw OpenAPI documents.
 *
 * Every surface that emits spec content to a client (`/openapi.json`,
 * `/openapi.yaml`, the API reference, try-it) loads it through
 * `loadSpecDocument`, which applies this once. Operations flagged
 * `x-excluded` / `x-hidden` (or hidden via docs.json overrides) are removed,
 * together with any component only they referenced.
 */

import { HTTP_METHODS, buildOperationKey } from './operation-keys'
import { isObj, methodsOf, operationVisibility, unescapePointer, viewPathEntry, type Obj } from './path-items'
import type { OpenAPIDocument, OperationOverride } from './types'

// Component maps we may prune. securitySchemes (and anything else) is always kept.
const PRUNABLE = new Set([
  'schemas',
  'parameters',
  'requestBodies',
  'responses',
  'examples',
  'headers',
  'callbacks',
  'links',
  'pathItems',
])

// Swagger 2.0 keeps its reusable objects at the document root instead of `components`.
const SWAGGER_MAPS = ['definitions', 'parameters', 'responses'] as const
const isSwagger = (document: Obj) => typeof document.swagger === 'string'

/** `#/components/<type>/<name>[/...]` -> `<type>/<name>`; Swagger 2.0 `#/definitions/<name>` -> `@definitions/<name>`; else null. */
function componentKey(ref: string, swagger: boolean): string | null {
  const match = /^#\/components\/([^/]+)\/([^/]+)/.exec(ref) ?? (swagger ? /^#\/(definitions|parameters|responses)\/([^/]+)/.exec(ref) : null)
  if (!match) return null
  const type = match[0].startsWith('#/components/') ? match[1] : `@${match[1]}`
  return `${type}/${unescapePointer(match[2])}`
}

const componentMap = (document: Obj, type: string): unknown =>
  type.startsWith('@') ? document[type.slice(1)] : isObj(document.components) ? document.components[type] : undefined

function collectRefs(root: unknown, onRef: (ref: string) => void) {
  const seen = new WeakSet<object>()
  const stack: Array<unknown> = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') onRef(value)
      // Discriminator mappings reference schemas by plain string.
      else if (key === 'mapping' && 'propertyName' in node && isObj(value)) {
        for (const target of Object.values(value)) if (typeof target === 'string') onRef(target)
      } else stack.push(value)
    }
  }
}

/** Component keys (`type/name`) reachable from everything outside `components`. */
function reachableComponents(document: Obj): Set<string> {
  const swagger = isSwagger(document)
  const rest = { ...document }
  delete rest.components
  if (swagger) for (const type of SWAGGER_MAPS) delete rest[type]
  const found = new Set<string>()
  const queue: Array<unknown> = [rest]
  const onRef = (ref: string) => {
    const key = componentKey(ref, swagger)
    if (!key || found.has(key)) return
    const [type, name] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
    const map = componentMap(document, type)
    const target = isObj(map) ? map[name] : undefined
    if (target === undefined) return
    found.add(key)
    queue.push(target)
  }
  while (queue.length) collectRefs(queue.pop(), onRef)
  return found
}

function collectTags(op: Obj, into: Set<string>) {
  if (Array.isArray(op.tags)) for (const tag of op.tags) if (typeof tag === 'string') into.add(tag)
}

/**
 * Remove excluded / hidden operations from a document for publication.
 *
 * Each `paths` / `webhooks` entry is evaluated on its own (see `path-items.ts`):
 * flags may sit on the entry next to a `$ref`, on any referenced item, or on the
 * operation, and docs.json overrides apply per path + method. A shared path item
 * is never edited: an entry that needs filtering is replaced by a filtered deep
 * copy of its resolved item, so other referrers keep the full definition. The
 * shared item is pruned from `components.pathItems` only once nothing references it.
 *
 * Fail-safe for refs that cannot be followed (external file, missing, circular):
 * flags on the reachable levels still apply and an entry carrying `x-excluded` /
 * `x-hidden` is dropped; an unflagged entry is left as written, since its
 * operations cannot be evaluated.
 */
export function sanitizeSpecForPublication(
  document: OpenAPIDocument,
  options: { overrides?: Record<string, OperationOverride> } = {},
): OpenAPIDocument {
  const doc = structuredClone(document) as Obj
  const removedTags = new Set<string>()
  let removed = false

  const dropOperations = (item: Obj, gone: Array<(typeof HTTP_METHODS)[number]>) => {
    for (const method of gone) {
      collectTags(item[method] as Obj, removedTags)
      delete item[method]
    }
    removed = true
  }

  // Everything is resolved against the untouched input, never the document being edited.
  const filterEntries = (items: unknown, isWebhook: boolean) => {
    if (!isObj(items)) return
    for (const [path, raw] of Object.entries(items)) {
      if (!isObj(raw)) continue
      const view = viewPathEntry(document, raw)
      if (view.excluded || (!view.complete && view.hidden)) {
        for (const method of methodsOf(view.item)) collectTags(view.item[method] as Obj, removedTags)
        delete items[path]
        removed = true
        continue
      }
      const gone = methodsOf(view.item).filter(
        (method) =>
          operationVisibility(view, method, options.overrides?.[buildOperationKey(method, path, isWebhook)]) !== 'visible',
      )
      if (!gone.length) continue
      const copy = structuredClone(view.item)
      delete copy['x-excluded']
      delete copy['x-hidden']
      dropOperations(copy, gone)
      if (methodsOf(copy).length) items[path] = copy
      else delete items[path]
    }
  }

  filterEntries(doc.paths, false)
  filterEntries(doc.webhooks, true)
  filterEntries(doc['x-webhooks'], true)

  // Component path items nothing references any more are not published paths, but
  // their flagged operations must not linger in the download.
  if (isObj(doc.components) && isObj(doc.components.pathItems)) {
    const items = doc.components.pathItems
    const reachable = reachableComponents(doc)
    for (const [name, raw] of Object.entries(items)) {
      if (!isObj(raw) || reachable.has(`pathItems/${name}`)) continue
      const view = viewPathEntry(document, raw)
      if (view.excluded) {
        dropOperations(view.item, methodsOf(view.item))
        delete items[name]
        continue
      }
      const gone = methodsOf(view.item).filter((method) => operationVisibility(view, method) !== 'visible')
      if (!gone.length) continue
      dropOperations(raw, gone)
      if (!methodsOf(raw).length) delete items[name]
    }
  }

  if (!removed) return document

  // An entry aliasing another path (`#/paths/...`) would dangle if that path was
  // filtered above: inline its original definition instead.
  for (const items of [doc.paths, doc.webhooks, doc['x-webhooks']]) {
    if (!isObj(items)) continue
    for (const [path, raw] of Object.entries(items)) {
      if (!isObj(raw) || typeof raw.$ref !== 'string') continue
      const view = viewPathEntry(document, raw)
      const aliasesPath = view.chain.some((level) => typeof level.$ref === 'string' && !level.$ref.startsWith('#/components/'))
      if (view.complete && aliasesPath) items[path] = structuredClone(view.item)
    }
  }

  // Tags: drop only those used by removed operations and by no kept one.
  const keptTags = new Set<string>()
  const componentPathItems = isObj(doc.components) && isObj(doc.components.pathItems) ? doc.components.pathItems : {}
  for (const items of [doc.paths, doc.webhooks, doc['x-webhooks'], componentPathItems]) {
    if (!isObj(items)) continue
    for (const entry of Object.values(items)) {
      if (!isObj(entry)) continue
      const { item } = viewPathEntry(document, entry)
      for (const method of methodsOf(item)) collectTags(item[method] as Obj, keptTags)
    }
  }
  const dropTag = (name: unknown) => typeof name === 'string' && removedTags.has(name) && !keptTags.has(name)
  if (Array.isArray(doc.tags)) doc.tags = doc.tags.filter((tag) => !(isObj(tag) && dropTag(tag.name)))
  if (Array.isArray(doc['x-tagGroups'])) {
    doc['x-tagGroups'] = doc['x-tagGroups'].map((group) =>
      isObj(group) && Array.isArray(group.tags)
        ? { ...group, tags: group.tags.filter((tag) => !dropTag(tag)) }
        : group,
    )
  }

  // Components: prune what the removed operations alone kept reachable.
  const after = reachableComponents(doc)
  for (const key of reachableComponents(document)) {
    if (after.has(key)) continue
    const [type, name] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
    const map = componentMap(doc, type)
    if ((PRUNABLE.has(type) || type.startsWith('@')) && isObj(map)) delete map[name]
  }

  return doc as OpenAPIDocument
}
