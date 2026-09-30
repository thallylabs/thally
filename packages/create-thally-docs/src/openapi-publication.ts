/**
 * Whether the operation an MDX page documents (`openapi: "GET /path"`) is
 * published. A page bound to a hidden or excluded operation 404s in the site,
 * so `thally check` reports it. Mirrors the site's path-item rules
 * (src/lib/openapi/path-items.ts, publication.ts); a parity test keeps the
 * two in step.
 */

type Obj = Record<string, unknown>

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const flagged = (value: unknown) => value === true || value === 'true'

/** `openapi: "GET /path"` frontmatter; anything else is not a reference. */
export function parseDocOperation(raw: unknown): { method: string; path: string } | null {
  if (typeof raw !== 'string') return null
  const parts = raw.trim().split(/\s+/)
  if (parts.length < 2) return null
  const path = parts.slice(1).join(' ')
  return path.startsWith('/') ? { method: parts[0].toUpperCase(), path } : null
}

function resolveLocalRef(document: unknown, ref: string): unknown {
  if (ref !== '#' && !ref.startsWith('#/')) return undefined
  let node: unknown = document
  for (const segment of ref.slice(2).split('/').filter(Boolean)) {
    if (!isObj(node) && !Array.isArray(node)) return undefined
    let decoded = segment
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      // keep the raw segment
    }
    node = (node as Obj)[decoded.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return node
}

/** `unknown` when the operation is absent or its `$ref` cannot be followed: never reported. */
export function operationState(
  document: unknown,
  method: string,
  path: string,
  overrides?: unknown,
): 'published' | 'hidden' | 'excluded' | 'unknown' {
  const verb = method.toLowerCase()
  if (!METHODS.includes(verb) || !isObj(document) || !isObj(document.paths)) return 'unknown'
  const entry = document.paths[path]
  if (!isObj(entry)) return 'unknown'
  const chain: Array<Obj> = [entry]
  const seen = new Set<Obj>([entry])
  for (let current = entry; typeof current.$ref === 'string'; ) {
    const target = resolveLocalRef(document, current.$ref)
    if (!isObj(target) || seen.has(target)) break
    seen.add(target)
    chain.push(target)
    current = target
  }
  const item: Obj = Object.assign({}, ...[...chain].reverse())
  const operation = item[verb]
  if (!isObj(operation)) return 'unknown'
  if (chain.some((level) => flagged(level['x-excluded'])) || flagged(operation['x-excluded'])) return 'excluded'
  const override = isObj(overrides) ? overrides[`${verb.toUpperCase()} ${path}`] : undefined
  const hidden = isObj(override) && typeof override.hidden === 'boolean'
    ? override.hidden
    : chain.some((level) => flagged(level['x-hidden'])) || flagged(operation['x-hidden'])
  return hidden ? 'hidden' : 'published'
}
