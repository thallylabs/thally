/**
 * `thally check` for manual `api:` pages. Mirrors the parts of
 * src/lib/openapi/manual-operation.ts the check needs (`parseApiFrontmatter`,
 * `normalizeServerUrl`, `extractParamFields`): the CLI cannot import the
 * site's source. A parity test (src/lib/openapi/__tests__/publication-check-parity.test.ts)
 * keeps the two in step.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

export interface ManualTarget {
  method: string
  server?: string
  path: string
  query: Record<string, string>
}

export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) return null
  return trimmed.replace(/\/+$/, '')
}

/** `api: "METHOD https://host/path?x=1"` or `"METHOD /path"`; null when the site would ignore it. */
export function parseManualApi(raw: unknown): ManualTarget | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
  const match = /^([A-Za-z]+)\s+(\S+)$/.exec(value)
  if (!match) return null
  const method = match[1].toUpperCase()
  if (!METHODS.has(method)) return null
  const split = /^(https?:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(match[2])
  if (!split || (!split[1] && !split[2].startsWith('/'))) return null
  let server: string | undefined
  if (split[1]) {
    const origin = normalizeServerUrl(split[1])
    if (!origin || split[1].includes('@')) return null
    server = origin
  }
  const query: Record<string, string> = {}
  if (split[3]) for (const [key, entry] of new URLSearchParams(split[3])) if (key) query[key] = entry
  return { method, ...(server ? { server } : {}), path: split[2] || '/', query }
}

interface MdxAttribute { type: string; name?: string; value?: string | null | { value?: string } }
interface MdxNode { type: string; name?: string | null; attributes?: Array<MdxAttribute>; children?: Array<MdxNode> }

function attributeValue(attribute: MdxAttribute | undefined): string | boolean | undefined {
  if (!attribute) return undefined
  const value = attribute.value
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value
  const expression = (value.value ?? '').trim()
  try {
    const parsed: unknown = JSON.parse(expression)
    if (typeof parsed === 'string' || typeof parsed === 'boolean') return parsed
    if (typeof parsed === 'number') return String(parsed)
    return expression
  } catch {
    return expression
  }
}

/** Names of the `<ParamField path=...>` elements the playground would use (same precedence and de-duplication as the site). */
export function paramFieldPathNames(mdx: string): Array<string> {
  let tree: MdxNode
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(mdx) as unknown as MdxNode
  } catch {
    return []
  }
  const names: Array<string> = []
  const seen = new Set<string>()
  const visit = (node: MdxNode) => {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'ParamField') {
      const attrs = new Map<string, MdxAttribute>()
      for (const attribute of node.attributes ?? []) {
        if (attribute.type === 'mdxJsxAttribute' && attribute.name) attrs.set(attribute.name, attribute)
      }
      const located = (['path', 'query', 'header', 'body'] as const).find((key) => {
        const value = attributeValue(attrs.get(key))
        return value !== undefined && value !== false && value !== 'false'
      })
      const locatedName = located ? attributeValue(attrs.get(located)) : undefined
      const explicit = attributeValue(attrs.get('name'))
      const name = typeof locatedName === 'string' && locatedName ? locatedName
        : typeof explicit === 'string' && explicit ? explicit
          : ''
      const location = located ?? 'body'
      if (name && !seen.has(`${location}:${name}`)) {
        seen.add(`${location}:${name}`)
        if (location === 'path') names.push(name)
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return names
}

/** Valid `api.mdx.server` entries of docs.json, as the site keeps them. */
export function mdxServers(docsApi: unknown): Array<string> {
  const mdx = (docsApi as { mdx?: { server?: unknown } } | undefined)?.mdx
  const raw = mdx?.server === undefined ? [] : Array.isArray(mdx.server) ? mdx.server : [mdx.server]
  return [...new Set(raw.flatMap((entry) => normalizeServerUrl(entry) ?? []))]
}

/** Problems with one page's manual `api:` frontmatter, each ready to show as a warning. */
export function manualApiProblems(
  file: string,
  data: { api?: unknown },
  hasOpenApiReference: boolean,
  mdx: string,
  docsApi: unknown,
): Array<string> {
  if (data.api === undefined || data.api === null) return []
  if (hasOpenApiReference) return [`page ${file}: both "openapi" and "api" are set; "api" is ignored`]
  const target = parseManualApi(data.api)
  if (!target) {
    return [`page ${file}: "api" frontmatter is not "METHOD https://host/path" or "METHOD /path"; the page renders without an API playground`]
  }
  const problems: Array<string> = []
  if (!target.server && mdxServers(docsApi).length === 0) {
    problems.push(`page ${file}: "api" is a path and docs.json has no server: set docs.json "api.mdx.server" or use a full URL, or the playground is disabled`)
  }
  const template = new Set([...target.path.matchAll(/{([^{}/]+)}/g)].map((match) => match[1]))
  for (const name of paramFieldPathNames(mdx)) {
    if (!template.has(name)) problems.push(`page ${file}: <ParamField path="${name}"> has no matching {${name}} in the "api" path; it is ignored in the playground`)
  }
  return problems
}
