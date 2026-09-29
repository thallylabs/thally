/**
 * Publication filter for raw OpenAPI documents.
 *
 * Every surface that emits spec content to a client (`/openapi.json`,
 * `/openapi.yaml`, the API reference, try-it) loads it through
 * `loadSpecDocument`, which applies this once. Operations flagged
 * `x-excluded` / `x-hidden` (or hidden via docs.json overrides) are removed,
 * together with any component only they referenced.
 */

import { HTTP_METHODS, buildOperationKey, isExtensionSet } from './operation-keys'
import type { OpenAPIDocument, OperationOverride } from './types'

type Obj = Record<string, unknown>

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

const isObj = (value: unknown): value is Obj =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const unescapePointer = (segment: string) =>
  decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~')

/** `#/components/<type>/<name>[/...]` -> `<type>/<name>` (name pointer-decoded), else null. */
function componentKey(ref: string): string | null {
  const match = /^#\/components\/([^/]+)\/([^/]+)/.exec(ref)
  if (!match) return null
  try {
    return `${match[1]}/${unescapePointer(match[2])}`
  } catch {
    return null
  }
}

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
  const { components, ...rest } = document
  const found = new Set<string>()
  const queue: Array<unknown> = [rest]
  const onRef = (ref: string) => {
    const key = componentKey(ref)
    if (!key || found.has(key)) return
    const [type, name] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
    const target = isObj(components) && isObj(components[type]) ? components[type][name] : undefined
    if (target === undefined) return
    found.add(key)
    queue.push(target)
  }
  while (queue.length) collectRefs(queue.pop(), onRef)
  return found
}

function opsOf(item: Obj) {
  return HTTP_METHODS.filter((method) => isObj(item[method]))
}

function collectTags(op: Obj, into: Set<string>) {
  if (Array.isArray(op.tags)) for (const tag of op.tags) if (typeof tag === 'string') into.add(tag)
}

export function sanitizeSpecForPublication(
  document: OpenAPIDocument,
  options: { overrides?: Record<string, OperationOverride> } = {},
): OpenAPIDocument {
  const doc = structuredClone(document) as Obj
  const removedTags = new Set<string>()
  const emptied = new WeakSet<object>()
  let removed = false

  const componentPathItems = isObj(doc.components) && isObj(doc.components.pathItems) ? doc.components.pathItems : {}
  const resolveItem = (raw: Obj): Obj => {
    const key = typeof raw.$ref === 'string' ? componentKey(raw.$ref) : null
    const target = key?.startsWith('pathItems/') ? componentPathItems[key.slice('pathItems/'.length)] : undefined
    return isObj(target) ? target : raw
  }

  const filterItems = (items: unknown, isWebhook: boolean, dropEntries = true) => {
    if (!isObj(items)) return
    for (const [path, raw] of Object.entries(items)) {
      if (!isObj(raw)) continue
      const item = resolveItem(raw)
      const before = opsOf(item)
      for (const method of before) {
        const op = item[method] as Obj
        const override = options.overrides?.[buildOperationKey(method, path, isWebhook)]?.hidden
        const hidden =
          isExtensionSet(op['x-excluded']) ||
          isExtensionSet(item['x-excluded']) ||
          (override ??
            (isExtensionSet(op['x-hidden']) || isExtensionSet(item['x-hidden'])))
        if (!hidden) continue
        collectTags(op, removedTags)
        delete item[method]
        removed = true
      }
      const nowEmpty = opsOf(item).length === 0
      if (nowEmpty && before.length > 0) emptied.add(item)
      if (dropEntries && ((nowEmpty && emptied.has(item)) || isExtensionSet(raw['x-excluded']) || isExtensionSet(item['x-excluded']))) {
        delete items[path]
        removed = true
      }
    }
  }

  filterItems(componentPathItems, false, false)
  filterItems(doc.paths, false)
  filterItems(doc.webhooks, true)
  filterItems(doc['x-webhooks'], true)

  if (!removed) return document

  // Tags: drop only those used by removed operations and by no kept one.
  const keptTags = new Set<string>()
  for (const items of [doc.paths, doc.webhooks, doc['x-webhooks'], componentPathItems]) {
    if (!isObj(items)) continue
    for (const item of Object.values(items)) {
      if (!isObj(item)) continue
      for (const method of opsOf(resolveItem(item))) collectTags(resolveItem(item)[method] as Obj, keptTags)
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
  if (isObj(doc.components)) {
    const after = reachableComponents(doc)
    for (const key of reachableComponents(document)) {
      if (after.has(key)) continue
      const [type, name] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
      const map = (doc.components as Obj)[type]
      if (PRUNABLE.has(type) && isObj(map)) delete map[name]
    }
  }

  return doc as OpenAPIDocument
}
