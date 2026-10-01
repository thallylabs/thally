/**
 * Whether the operation an MDX page documents (`openapi: "[<spec>] GET /path"`) is
 * published. A page bound to a hidden or excluded operation 404s in the site,
 * so `thally check` reports it. Mirrors the site's path-item rules
 * (src/lib/openapi/path-items.ts, publication.ts); a parity test keeps the
 * two in step.
 */

type Obj = Record<string, unknown>

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const flagged = (value: unknown) => value === true || value === 'true'

/** An MDX page's `openapi:` reference (src/lib/openapi/page-frontmatter.ts). */
export interface DocReference {
  /** Spec file/URL prefix as authored, unquoted; absent for the bare form. */
  specRef?: string
  method: string
  path: string
  webhook?: boolean
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  return (quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote) ? trimmed.slice(1, -1).trim() : trimmed
}

/** `openapi: "[<spec>] METHOD /path"` or `"[<spec>] webhook <name>"` frontmatter; anything else is not a reference. */
export function parseDocReference(raw: unknown): DocReference | null {
  if (typeof raw !== 'string') return null
  const trimmed = unquote(raw)
  if (!trimmed) return null
  const webhook = /^(?:(.*?\S)\s+)?webhook\s+([^\s/]\S*)$/i.exec(trimmed)
  if (webhook) {
    const specRef = webhook[1] ? unquote(webhook[1]) : undefined
    return { ...(specRef ? { specRef } : {}), method: 'WEBHOOK', path: webhook[2], webhook: true }
  }
  const operation = /^(?:(.*?\S)\s+)?([A-Za-z]+)\s+(\/.*)$/.exec(trimmed)
  if (!operation) return null
  const specRef = operation[1] ? unquote(operation[1]) : undefined
  return { ...(specRef ? { specRef } : {}), method: operation[2].toUpperCase(), path: operation[3].trim().split(/\s+/).join(' ') }
}

/** Case survives except in a URL's scheme and host. Mirrors `canonicalRef` in src/lib/openapi/page-frontmatter.ts. */
const canonicalRef = (value: string) => value.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, (origin) => origin.toLowerCase())
const baseName = (value: string) => canonicalRef(value).split(/[?#]/, 1)[0].split('/').filter(Boolean).pop() ?? ''

/** A spec the docs route serves, in route order (visible API tabs, default first). No document when it cannot be read here. */
export interface CheckSpec {
  source: string
  overrides?: unknown
  document?: unknown
}

/**
 * Whether the docs route renders the operation a page names: a spec prefix
 * pins that spec (full path, else file name; exact case before case-insensitive); a bare reference renders when
 * any spec publishes it. Mirrors `pageReferenceState` in
 * src/lib/openapi/publication.ts.
 */
export function pageState(ref: DocReference, specs: ReadonlyArray<CheckSpec>): 'published' | 'hidden' | 'excluded' | 'unknown' {
  const judge = (spec: CheckSpec) => spec.document === undefined
    ? 'unknown'
    : ref.webhook ? webhookState(spec.document, ref.path, spec.overrides) : operationState(spec.document, ref.method, ref.path, spec.overrides)
  if (ref.specRef) {
    const wanted = canonicalRef(ref.specRef)
    if (!wanted) return 'unknown'
    const wantedBase = baseName(ref.specRef)
    const spec = specs.find((entry) => canonicalRef(entry.source) === wanted)
      ?? specs.find((entry) => canonicalRef(entry.source).toLowerCase() === wanted.toLowerCase())
      ?? (wantedBase ? specs.find((entry) => baseName(entry.source) === wantedBase) : undefined)
      ?? (wantedBase ? specs.find((entry) => baseName(entry.source).toLowerCase() === wantedBase.toLowerCase()) : undefined)
    return spec ? judge(spec) : 'unknown'
  }
  const states = specs.map(judge)
  if (states.includes('published')) return 'published'
  if (specs.some((spec) => spec.document === undefined)) return 'unknown'
  return states.find((state) => state === 'hidden' || state === 'excluded') ?? 'unknown'
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

type State = 'published' | 'hidden' | 'excluded' | 'unknown'

/** A path-item entry followed through local `$ref`s, as `viewPathEntry` does: the chain and the merged item. */
function viewEntry(document: unknown, entry: Obj): { chain: Array<Obj>; item: Obj } {
  const chain: Array<Obj> = [entry]
  const seen = new Set<Obj>([entry])
  for (let current = entry; typeof current.$ref === 'string'; ) {
    const target = resolveLocalRef(document, current.$ref)
    if (!isObj(target) || seen.has(target)) break
    seen.add(target)
    chain.push(target)
    current = target
  }
  return { chain, item: Object.assign({}, ...[...chain].reverse()) }
}

/** One method of an entry: `excluded` wins, an override decides `hidden`, otherwise the flags do. */
function visibility(chain: Array<Obj>, operation: Obj, override: unknown): 'visible' | 'hidden' | 'excluded' {
  if (chain.some((level) => flagged(level['x-excluded'])) || flagged(operation['x-excluded'])) return 'excluded'
  const hidden = isObj(override) && typeof override.hidden === 'boolean'
    ? override.hidden
    : chain.some((level) => flagged(level['x-hidden'])) || flagged(operation['x-hidden'])
  return hidden ? 'hidden' : 'visible'
}

/** `unknown` when the operation is absent or its `$ref` cannot be followed: never reported. */
export function operationState(
  document: unknown,
  method: string,
  path: string,
  overrides?: unknown,
): State {
  const verb = method.toLowerCase()
  if (!METHODS.includes(verb) || !isObj(document) || !isObj(document.paths)) return 'unknown'
  const entry = document.paths[path]
  if (!isObj(entry)) return 'unknown'
  const { chain, item } = viewEntry(document, entry)
  const operation = item[verb]
  if (!isObj(operation)) return 'unknown'
  const result = visibility(chain, operation, isObj(overrides) ? overrides[`${verb.toUpperCase()} ${path}`] : undefined)
  return result === 'visible' ? 'published' : result
}

/** A webhook page renders when any method of the `webhooks` entry is visible; `x-webhooks` never renders one. */
export function webhookState(document: unknown, name: string, overrides?: unknown): State {
  if (!isObj(document) || !isObj(document.webhooks) || !Object.hasOwn(document.webhooks, name)) return 'unknown'
  const entry = document.webhooks[name]
  if (!isObj(entry)) return 'unknown'
  const { chain, item } = viewEntry(document, entry)
  const states = METHODS.filter((verb) => isObj(item[verb])).map((verb) =>
    visibility(chain, item[verb] as Obj, isObj(overrides) ? overrides[`WEBHOOK ${verb.toUpperCase()} ${name}`] : undefined))
  if (states.length === 0) return 'unknown'
  return states.includes('visible') ? 'published' : states[0] as 'hidden' | 'excluded'
}
